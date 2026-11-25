#!/usr/bin/env python3
"""
Linux PTY hardware emulator for the Aoostar 960x376 USB-UART LCD protocol
(zehnm/aoostar-rs / crates/asterctl-lcd/src/aoo_screen.rs).

Protocol implemented:
- DISPLAY_ON:   AA 55 AA 55 0B 00 00 00 -> responds b'A' (0x41) unless --no-ack / --bad-ack
- DISPLAY_OFF:  AA 55 AA 55 0A 00 00 00
- HEADER_START: AA 55 AA 55 05 00 00 00 04 00 0F 2F 00 04 0B 00 (16 bytes)
- CHUNK:        AA 55 AA 55 08 00 00 00 <u32 LE offset> <47B RGB565> (59 bytes)
- HEADER_END:   AA 55 AA 55 06 00 00 00
"""

import argparse
import errno
import hashlib
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time
import tty

DISPLAY_OFF = bytes([0xAA, 0x55, 0xAA, 0x55, 0x0A, 0x00, 0x00, 0x00])
DISPLAY_ON = bytes([0xAA, 0x55, 0xAA, 0x55, 0x0B, 0x00, 0x00, 0x00])
HEADER_START = bytes([
    0xAA, 0x55, 0xAA, 0x55, 0x05, 0x00, 0x00, 0x00,
    0x04, 0x00, 0x0F, 0x2F, 0x00, 0x04, 0x0B, 0x00,
])
HEADER_END = bytes([0xAA, 0x55, 0xAA, 0x55, 0x06, 0x00, 0x00, 0x00])
CHUNK_HEADER = bytes([0xAA, 0x55, 0xAA, 0x55, 0x08, 0x00, 0x00, 0x00])
MAGIC = bytes([0xAA, 0x55, 0xAA, 0x55])

FRAME_BYTES = 960 * 376 * 2  # 721,920
CHUNK_SIZE = 47


def write_state(path: str, state: dict) -> None:
    if not path:
        return
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp, path)


def configure_raw_pty(fd: int) -> None:
    tty.setraw(fd, termios.TCSANOW)
    attrs = termios.tcgetattr(fd)
    # Ensure zero kernel line translation or flow control on binary frames
    attrs[0] &= ~(termios.ICRNL | termios.INLCR | termios.IGNCR | termios.IXON | termios.IXOFF)
    attrs[1] &= ~(termios.OPOST | termios.ONLCR)
    attrs[3] &= ~(termios.ECHO | termios.ICANON | termios.ISIG | termios.IEXTEN)
    termios.tcsetattr(fd, termios.TCSANOW, attrs)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-file", default="")
    parser.add_argument("--no-ack", action="store_true")
    parser.add_argument("--bad-ack", default="")
    args = parser.parse_args()

    master_fd, slave_fd = pty.openpty()
    configure_raw_pty(master_fd)
    configure_raw_pty(slave_fd)
    slave_path = os.ttyname(slave_fd)

    running = True

    def stop_handler(_sig, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)

    framebuffer = bytearray(FRAME_BYTES)
    in_frame = False
    current_offsets = []
    buf = bytearray()

    state = {
        "slave_path": slave_path,
        "display_on_count": 0,
        "display_off_count": 0,
        "frames": [],
        "unknown_bytes": 0,
    }
    write_state(args.state_file, state)

    print(json.dumps({"ready": True, "slave_path": slave_path}), flush=True)

    try:
        while running:
            rlist, _, _ = select.select([master_fd], [], [], 0.05)
            if master_fd not in rlist:
                continue

            try:
                chunk = os.read(master_fd, 65536)
            except OSError as exc:
                if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK, errno.EINTR, errno.EIO):
                    # Slave side temporarily closed between sessions -> keep master alive
                    time.sleep(0.01)
                    continue
                raise

            if not chunk:
                time.sleep(0.01)
                continue

            buf.extend(chunk)

            while len(buf) >= 8:
                # Re-align to AA 55 AA 55 magic if needed
                if buf[:4] != MAGIC:
                    idx = buf.find(MAGIC)
                    if idx == -1:
                        drop = max(0, len(buf) - 3)
                        if drop > 0:
                            state["unknown_bytes"] += drop
                            del buf[:drop]
                        break
                    if idx > 0:
                        state["unknown_bytes"] += idx
                        del buf[:idx]
                    if len(buf) < 8:
                        break

                cmd = buf[4]
                if cmd == 0x0B:  # DISPLAY_ON
                    del buf[:8]
                    state["display_on_count"] += 1
                    if not args.no_ack:
                        reply = bytes.fromhex(args.bad_ack) if args.bad_ack else b"A"
                        os.write(master_fd, reply)
                    write_state(args.state_file, state)
                elif cmd == 0x0A:  # DISPLAY_OFF
                    del buf[:8]
                    state["display_off_count"] += 1
                    write_state(args.state_file, state)
                elif cmd == 0x05:  # HEADER_START (16 bytes)
                    if len(buf) < 16:
                        break
                    pkt = bytes(buf[:16])
                    del buf[:16]
                    if pkt == HEADER_START:
                        in_frame = True
                        current_offsets = []
                    else:
                        state["unknown_bytes"] += 16
                elif cmd == 0x08:  # CHUNK (59 bytes)
                    if len(buf) < 59:
                        break
                    offset = struct.unpack_from("<I", buf, 8)[0]
                    payload = bytes(buf[12:59])
                    del buf[:59]
                    if in_frame and 0 <= offset <= FRAME_BYTES - CHUNK_SIZE:
                        framebuffer[offset : offset + CHUNK_SIZE] = payload
                        current_offsets.append(offset)
                elif cmd == 0x06:  # HEADER_END
                    del buf[:8]
                    frame_hash = hashlib.sha256(framebuffer).hexdigest()[:12].upper()
                    state["frames"].append({
                        "chunks_received": len(current_offsets),
                        "first_offset": current_offsets[0] if current_offsets else None,
                        "last_offset": current_offsets[-1] if current_offsets else None,
                        "offsets_sample": current_offsets[:5],
                        "sha256_short": frame_hash,
                    })
                    in_frame = False
                    write_state(args.state_file, state)
                else:
                    state["unknown_bytes"] += 1
                    del buf[:1]
    finally:
        write_state(args.state_file, state)
        for fd in (slave_fd, master_fd):
            try:
                os.close(fd)
            except OSError:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())

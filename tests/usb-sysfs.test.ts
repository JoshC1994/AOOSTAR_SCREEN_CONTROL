import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readUsbAttrsForTty} from '../src/server/aoostar/serial.ts';

function makeLinuxRdev(major: number, minor: number): number {
  const maj = BigInt(major);
  const min = BigInt(minor);
  return Number(((maj & 0xfffn) << 8n) | (min & 0xffn) | ((min & ~0xffn) << 12n));
}

test('readUsbAttrsForTty resolves standard Linux /sys/class/tty/<tty>/device symlink to USB parent', () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sysfs-std-'));
  try {
    const usbDevDir = path.join(sysRoot, 'devices/pci0000:00/0000:00:14.0/usb1/1-3');
    const usbIfDir = path.join(usbDevDir, '1-3:1.0');
    const ttyDevDir = path.join(usbIfDir, 'tty/ttyACM0');
    fs.mkdirSync(ttyDevDir, {recursive: true});
    fs.mkdirSync(path.join(sysRoot, 'class/tty'), {recursive: true});

    fs.writeFileSync(path.join(usbDevDir, 'idVendor'), '0416\n');
    fs.writeFileSync(path.join(usbDevDir, 'idProduct'), '90a1\n');
    fs.writeFileSync(path.join(usbDevDir, 'product'), 'AOOSTAR-LCD\n');

    // Mirror real Linux kernel sysfs relative symlinks
    fs.symlinkSync('../../../1-3:1.0', path.join(ttyDevDir, 'device'));
    fs.symlinkSync(
      '../../devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.0/tty/ttyACM0',
      path.join(sysRoot, 'class/tty/ttyACM0')
    );

    const attrs = readUsbAttrsForTty('/dev/ttyACM0', {sysRoot, devRealPath: '/dev/ttyACM0'});
    assert.equal(attrs.vendorId, '0416');
    assert.equal(attrs.productId, '90a1');
    assert.equal(attrs.name, 'AOOSTAR-LCD');
  } finally {
    fs.rmSync(sysRoot, {recursive: true, force: true});
  }
});

test('readUsbAttrsForTty walks multi-hub USB hierarchies and returns closest device (not parent hub)', () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sysfs-hub-'));
  try {
    const hubDir = path.join(sysRoot, 'devices/pci0000:00/0000:00:14.0/usb1/1-2');
    const leafDevDir = path.join(hubDir, '1-2.4/1-2.4.1');
    const usbIfDir = path.join(leafDevDir, '1-2.4.1:1.0');
    const ttySubDir = path.join(usbIfDir, 'ttyUSB0');
    const ttyClassDir = path.join(sysRoot, 'class/tty/ttyUSB0');
    fs.mkdirSync(ttySubDir, {recursive: true});
    fs.mkdirSync(ttyClassDir, {recursive: true});

    // Parent hub has a different VID/PID
    fs.writeFileSync(path.join(hubDir, 'idVendor'), '1d6b\n');
    fs.writeFileSync(path.join(hubDir, 'idProduct'), '0002\n');
    fs.writeFileSync(path.join(hubDir, 'product'), 'Root Hub\n');

    // Leaf USB device has Aoostar VID/PID
    fs.writeFileSync(path.join(leafDevDir, 'idVendor'), '0416\n');
    fs.writeFileSync(path.join(leafDevDir, 'idProduct'), '90a1\n');
    fs.writeFileSync(path.join(leafDevDir, 'product'), 'Aoostar Hub LCD\n');

    fs.symlinkSync(ttySubDir, path.join(ttyClassDir, 'device'));

    const attrs = readUsbAttrsForTty('/dev/ttyUSB0', {sysRoot, devRealPath: '/dev/ttyUSB0'});
    assert.equal(attrs.vendorId, '0416');
    assert.equal(attrs.productId, '90a1');
    assert.equal(attrs.name, 'Aoostar Hub LCD');
  } finally {
    fs.rmSync(sysRoot, {recursive: true, force: true});
  }
});

test('readUsbAttrsForTty prioritizes /sys/dev/char/<major>:<minor> for Docker remapped devices', () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sysfs-char-'));
  try {
    // Host ttyACM0 is a wrong device (e.g. Zigbee adapter)
    const wrongDevDir = path.join(sysRoot, 'devices/usb1/1-1');
    const wrongIfDir = path.join(wrongDevDir, '1-1:1.0');
    fs.mkdirSync(path.join(wrongIfDir, 'tty/ttyACM0'), {recursive: true});
    fs.writeFileSync(path.join(wrongDevDir, 'idVendor'), '10c4\n');
    fs.writeFileSync(path.join(wrongDevDir, 'idProduct'), 'ea60\n');
    fs.mkdirSync(path.join(sysRoot, 'class/tty/ttyACM0'), {recursive: true});
    fs.symlinkSync(wrongIfDir, path.join(sysRoot, 'class/tty/ttyACM0/device'));

    // Host ttyACM1 (166:1) is Aoostar, mapped into container as /dev/ttyACM0
    const rightDevDir = path.join(sysRoot, 'devices/usb1/1-4');
    const rightIfDir = path.join(rightDevDir, '1-4:1.0');
    const rightTtyDir = path.join(rightIfDir, 'tty/ttyACM1');
    fs.mkdirSync(rightTtyDir, {recursive: true});
    fs.writeFileSync(path.join(rightDevDir, 'idVendor'), '0416\n');
    fs.writeFileSync(path.join(rightDevDir, 'idProduct'), '90a1\n');
    fs.writeFileSync(path.join(rightDevDir, 'product'), 'Aoostar Remapped\n');
    fs.symlinkSync('../../../1-4:1.0', path.join(rightTtyDir, 'device'));

    fs.mkdirSync(path.join(sysRoot, 'dev/char'), {recursive: true});
    fs.symlinkSync(rightTtyDir, path.join(sysRoot, 'dev/char/166:1'));

    const attrs = readUsbAttrsForTty('/dev/ttyACM0', {
      sysRoot,
      rdev: makeLinuxRdev(166, 1),
      devRealPath: '/dev/ttyACM0',
    });
    assert.equal(attrs.vendorId, '0416');
    assert.equal(attrs.productId, '90a1');
    assert.equal(attrs.name, 'Aoostar Remapped');
  } finally {
    fs.rmSync(sysRoot, {recursive: true, force: true});
  }
});

test('readUsbAttrsForTty falls back to uevent PRODUCT= and /sys/bus/usb/devices scan', () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sysfs-uevent-'));
  try {
    const usbIfDir = path.join(sysRoot, 'devices/usb1/1-5/1-5:1.0');
    fs.mkdirSync(path.join(usbIfDir, 'tty/ttyACM0'), {recursive: true});
    // Kernel uevent strips leading zero from 0416 -> 416
    fs.writeFileSync(
      path.join(usbIfDir, 'uevent'),
      'DEVTYPE=usb_interface\nDRIVER=cdc_acm\nPRODUCT=416/90a1/100\nINTERFACE=2/2/1\n'
    );
    fs.mkdirSync(path.join(sysRoot, 'bus/usb/devices'), {recursive: true});
    fs.symlinkSync(usbIfDir, path.join(sysRoot, 'bus/usb/devices/1-5:1.0'));

    const attrs = readUsbAttrsForTty('/dev/ttyACM0', {sysRoot, devRealPath: '/dev/ttyACM0'});
    assert.equal(attrs.vendorId, '0416');
    assert.equal(attrs.productId, '90a1');
  } finally {
    fs.rmSync(sysRoot, {recursive: true, force: true});
  }
});

test('readUsbAttrsForTty fails closed (unknown) for non-USB serial ports', () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sysfs-nonusb-'));
  try {
    const pnpDevDir = path.join(sysRoot, 'devices/pnp0/00:02');
    fs.mkdirSync(path.join(pnpDevDir, 'tty/ttyS0'), {recursive: true});
    fs.writeFileSync(path.join(pnpDevDir, 'uevent'), 'DRIVER=serial\n');
    fs.mkdirSync(path.join(sysRoot, 'class/tty/ttyS0'), {recursive: true});
    fs.symlinkSync(pnpDevDir, path.join(sysRoot, 'class/tty/ttyS0/device'));

    const attrs = readUsbAttrsForTty('/dev/ttyS0', {sysRoot, devRealPath: '/dev/ttyS0'});
    assert.equal(attrs.vendorId, 'unknown');
    assert.equal(attrs.productId, 'unknown');
  } finally {
    fs.rmSync(sysRoot, {recursive: true, force: true});
  }
});

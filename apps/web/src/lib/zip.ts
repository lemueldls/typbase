export interface ZipEntry {
  /** Bundle-relative path, forward slashes. */
  name: string;
  bytes: Uint8Array;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  crcTable ??= (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }

    return table;
  })();

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** DOS date for 2026-01-01; ZIP needs a timestamp and exports are not archival. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, 0, true); // stored
    localView.setUint16(10, 0, true); // time
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    parts.push(local, entry.bytes);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true); // version made by
    directoryView.setUint16(6, 20, true); // version needed
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, 0, true);
    directoryView.setUint16(14, DOS_DATE, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, entry.bytes.length, true);
    directoryView.setUint32(24, entry.bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint16(30, 0, true); // extra
    directoryView.setUint16(32, 0, true); // comment
    directoryView.setUint16(34, 0, true); // disk
    directoryView.setUint16(36, 0, true); // internal attrs
    directoryView.setUint32(38, 0, true); // external attrs
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    centralSize += directory.length;

    offset += local.length + entry.bytes.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concat([...parts, ...central, end], offset + centralSize + end.length);
}

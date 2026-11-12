import type {
  Sheet,
  Contributor,
  Item,
  ItemConsumer,
  SheetExportData,
} from '../types/models';
import { ITEM_TYPE } from '../types/models';

const MAGIC = 0x4253504c; // "BSPL"
const VERSION_V2 = 2;
const VERSION_V3 = 3;
const VERSION = 4;
const IV_LENGTH_BYTES = 12;
const GCM_TAG_BITS = 128;
const GCM_TAG_BYTES = GCM_TAG_BITS / 8;
const SIGNATURE_LENGTH_BYTES = 32;
const HEADER_BYTES = 8; // MAGIC (4) + VERSION (4)
const MIN_ENVELOPE_BYTES =
  HEADER_BYTES + IV_LENGTH_BYTES + 4 + GCM_TAG_BYTES + SIGNATURE_LENGTH_BYTES;
const MAX_RECORDS = 100_000;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

const seedMaskA = new Uint8Array([
  0x4b, 0x91, 0x2c, 0xe7, 0x18, 0x6f, 0xb3, 0x05, 0xd4, 0x7a, 0x39, 0xc2, 0x5e,
  0x80, 0xf1, 0x16, 0x9d, 0x24, 0x63, 0xab, 0x0c, 0xef, 0x48, 0x71, 0xd9, 0x32,
  0x85, 0x1a, 0xc7, 0x50, 0x6e, 0xbe,
]);

const seedMaskB = new Uint8Array([
  0x19, 0xc4, 0x7f, 0x38, 0x6d, 0xa2, 0x51, 0xe9, 0x04, 0xb8, 0x62, 0x1d, 0xf3,
  0x47, 0x90, 0x2b, 0xce, 0x56, 0x11, 0x7c, 0x8a, 0x35, 0xd0, 0x9f, 0x26, 0x64,
  0xe1, 0x43, 0x9b, 0x0e, 0x77, 0x55,
]);

class ByteBufferWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number = 0;
  private textEncoder = new TextEncoder();

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(needed: number) {
    if (this.offset + needed <= this.buffer.byteLength) return;
    const newCap = Math.max(this.buffer.byteLength * 2, this.offset + needed);
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buffer);
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer);
  }

  writeInt(val: number) {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, false);
    this.offset += 4;
  }

  writeLong(val: number | bigint) {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.offset, BigInt(val), false);
    this.offset += 8;
  }

  writeDouble(val: number) {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, false);
    this.offset += 8;
  }

  writeBoolean(val: boolean) {
    this.ensureCapacity(1);
    this.buffer[this.offset] = val ? 1 : 0;
    this.offset += 1;
  }

  writeString(val: string) {
    const encoded = this.textEncoder.encode(val);
    this.writeInt(encoded.length);
    this.ensureCapacity(encoded.length);
    this.buffer.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  writeNullableString(val: string | null | undefined) {
    if (val != null) {
      this.writeBoolean(true);
      this.writeString(val);
    } else {
      this.writeBoolean(false);
    }
  }

  toByteArray(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

class ByteBufferReader {
  private view: DataView;
  private offset: number = 0;
  private textDecoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  readInt(): number {
    if (this.offset + 4 > this.buffer.byteLength) throw new Error('Unexpected EOF reading int');
    const val = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readLong(): number {
    if (this.offset + 8 > this.buffer.byteLength) throw new Error('Unexpected EOF reading long');
    const val = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return Number(val);
  }

  readDouble(): number {
    if (this.offset + 8 > this.buffer.byteLength) throw new Error('Unexpected EOF reading double');
    const val = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return val;
  }

  readBoolean(): boolean {
    if (this.offset + 1 > this.buffer.byteLength) throw new Error('Unexpected EOF reading boolean');
    const val = this.buffer[this.offset] !== 0;
    this.offset += 1;
    return val;
  }

  readString(): string {
    const size = this.readInt();
    if (size < 0 || size > 1_000_000) {
      throw new Error('The sheet file contains invalid text.');
    }
    if (this.offset + size > this.buffer.byteLength) {
      throw new Error('Unexpected EOF reading string bytes');
    }
    const slice = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return this.textDecoder.decode(slice);
  }

  readNullableString(): string | null {
    const isPresent = this.readBoolean();
    return isPresent ? this.readString() : null;
  }

  available(): number {
    return this.buffer.byteLength - this.offset;
  }
}

async function deriveMaterial(domain: number): Promise<Uint8Array> {
  const input = new Uint8Array(1 + seedMaskA.length);
  input[0] = domain & 0xff;
  for (let i = 0; i < seedMaskA.length; i++) {
    const a = seedMaskA[i];
    const b = seedMaskB[(i * 7 + domain) % seedMaskB.length];
    input[1 + i] = ((a ^ b) + (i * 13 + domain)) & 0xff;
  }
  const digest = await crypto.subtle.digest('SHA-256', input as unknown as BufferSource);
  return new Uint8Array(digest);
}

async function getAesKey(): Promise<CryptoKey> {
  const keyBytes = await deriveMaterial(0x3a);
  return crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function getSigningKey(): Promise<CryptoKey> {
  const keyBytes = await deriveMaterial(0x7c);
  return crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function buildHeader(version: number = VERSION): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  view.setInt32(0, MAGIC, false);
  view.setInt32(4, version, false);
  return header;
}

function encodePayload(data: SheetExportData): Uint8Array {
  const writer = new ByteBufferWriter(4096);

  // 1. Sheet
  writer.writeInt(data.sheet.sheetID);
  writer.writeString(data.sheet.sheetName);
  writer.writeLong(data.sheet.dateCreated);
  writer.writeLong(data.sheet.dateModified);
  writer.writeNullableString(data.sheet.notes);
  writer.writeBoolean(data.sheet.isReadOnly);

  // 2. Contributors
  const sortedContributors = [...data.contributors].sort((a, b) => a.contributorID - b.contributorID);
  writer.writeInt(sortedContributors.length);
  for (const c of sortedContributors) {
    writer.writeInt(c.contributorID);
    writer.writeString(c.contributorName);
    writer.writeInt(c.sheetID);
  }

  // 3. Items
  const sortedItems = [...data.items].sort((a, b) => a.itemID - b.itemID);
  writer.writeInt(sortedItems.length);
  for (const item of sortedItems) {
    writer.writeInt(item.itemID);
    writer.writeInt(item.sheetID);
    writer.writeString(item.itemName);
    writer.writeDouble(item.amount);
    writer.writeInt(item.payerID);
    writer.writeLong(item.dateCreated);
    writer.writeLong(item.dateModified);
    writer.writeNullableString(item.notes);
    writer.writeInt(item.itemType ?? ITEM_TYPE.TYPE_EXPENSE);
  }

  // 4. ItemConsumers
  const sortedConsumers = [...data.itemConsumers].sort((a, b) => {
    if (a.itemID !== b.itemID) return a.itemID - b.itemID;
    return a.contributorID - b.contributorID;
  });
  writer.writeInt(sortedConsumers.length);
  for (const ic of sortedConsumers) {
    writer.writeInt(ic.itemID);
    writer.writeInt(ic.contributorID);
    writer.writeDouble(ic.weight);
  }

  return writer.toByteArray();
}

function decodePayload(plaintext: Uint8Array, version: number): SheetExportData {
  const reader = new ByteBufferReader(plaintext);

  // 1. Sheet
  const sheet: Sheet = {
    sheetID: reader.readInt(),
    sheetName: reader.readString(),
    dateCreated: reader.readLong(),
    dateModified: reader.readLong(),
    notes: reader.readNullableString(),
    isReadOnly: version >= VERSION ? reader.readBoolean() : false,
  };

  // 2. Contributors
  const contribCount = reader.readInt();
  if (contribCount < 0 || contribCount > MAX_RECORDS) {
    throw new Error('The sheet file appears to be corrupted.');
  }
  const contributors: Contributor[] = [];
  for (let i = 0; i < contribCount; i++) {
    contributors.push({
      contributorID: reader.readInt(),
      contributorName: reader.readString(),
      sheetID: reader.readInt(),
    });
  }

  // 3. Items
  const itemCount = reader.readInt();
  if (itemCount < 0 || itemCount > MAX_RECORDS) {
    throw new Error('The sheet file appears to be corrupted.');
  }
  const items: Item[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      itemID: reader.readInt(),
      sheetID: reader.readInt(),
      itemName: reader.readString(),
      amount: reader.readDouble(),
      payerID: reader.readInt(),
      dateCreated: reader.readLong(),
      dateModified: reader.readLong(),
      notes: reader.readNullableString(),
      itemType: (version >= VERSION_V3 ? reader.readInt() : ITEM_TYPE.TYPE_EXPENSE) as Item['itemType'],
    });
  }

  // 4. ItemConsumers
  const consumerCount = reader.readInt();
  if (consumerCount < 0 || consumerCount > MAX_RECORDS) {
    throw new Error('The sheet file appears to be corrupted.');
  }
  const itemConsumers: ItemConsumer[] = [];
  for (let i = 0; i < consumerCount; i++) {
    itemConsumers.push({
      itemID: reader.readInt(),
      contributorID: reader.readInt(),
      weight: reader.readDouble(),
    });
  }

  if (reader.available() !== 0) {
    throw new Error('Invalid or corrupted .bsplit payload (trailing bytes).');
  }

  return { sheet, contributors, items, itemConsumers };
}

export class SheetBinaryCodec {
  static async encode(data: SheetExportData): Promise<Uint8Array> {
    const plaintext = encodePayload(data);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const header = buildHeader(VERSION);

    const aesKey = await getAesKey();
    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: header as unknown as BufferSource,
        tagLength: GCM_TAG_BITS,
      },
      aesKey,
      plaintext as unknown as BufferSource
    );
    const ciphertext = new Uint8Array(ciphertextBuffer);

    const unsignedLen = HEADER_BYTES + IV_LENGTH_BYTES + 4 + ciphertext.length;
    const unsignedEnvelope = new Uint8Array(unsignedLen);
    unsignedEnvelope.set(header, 0);
    unsignedEnvelope.set(iv, HEADER_BYTES);
    new DataView(unsignedEnvelope.buffer, unsignedEnvelope.byteOffset).setInt32(
      HEADER_BYTES + IV_LENGTH_BYTES,
      ciphertext.length,
      false
    );
    unsignedEnvelope.set(ciphertext, HEADER_BYTES + IV_LENGTH_BYTES + 4);

    const signingKey = await getSigningKey();
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      signingKey,
      unsignedEnvelope as unknown as BufferSource
    );
    const signature = new Uint8Array(signatureBuffer);

    const fullResult = new Uint8Array(unsignedEnvelope.length + signature.length);
    fullResult.set(unsignedEnvelope, 0);
    fullResult.set(signature, unsignedEnvelope.length);

    return fullResult;
  }

  static async decode(bytes: Uint8Array): Promise<SheetExportData> {
    if (bytes.length < MIN_ENVELOPE_BYTES) {
      throw new Error('Invalid or corrupted .bsplit file.');
    }

    const signedContentLength = bytes.length - SIGNATURE_LENGTH_BYTES;
    const unsignedEnvelope = bytes.subarray(0, signedContentLength);
    const actualSignature = bytes.subarray(signedContentLength);

    const signingKey = await getSigningKey();
    const isValidSig = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      actualSignature as unknown as BufferSource,
      unsignedEnvelope as unknown as BufferSource
    );
    if (!isValidSig) {
      throw new Error('Invalid signature: this .bsplit file was modified or is not from Bill Splitter.');
    }

    const view = new DataView(
      unsignedEnvelope.buffer,
      unsignedEnvelope.byteOffset,
      unsignedEnvelope.byteLength
    );
    const magic = view.getInt32(0, false);
    const version = view.getInt32(4, false);

    if (magic !== MAGIC || version < VERSION_V2 || version > VERSION) {
      throw new Error('Unsupported or invalid .bsplit file.');
    }

    const iv = unsignedEnvelope.subarray(HEADER_BYTES, HEADER_BYTES + IV_LENGTH_BYTES);
    const ciphertextLen = view.getInt32(HEADER_BYTES + IV_LENGTH_BYTES, false);
    const expectedCiphertextLen = signedContentLength - HEADER_BYTES - IV_LENGTH_BYTES - 4;

    if (
      ciphertextLen < GCM_TAG_BYTES ||
      ciphertextLen > MAX_PAYLOAD_BYTES ||
      ciphertextLen !== expectedCiphertextLen
    ) {
      throw new Error('Invalid or corrupted .bsplit payload.');
    }

    const ciphertext = unsignedEnvelope.subarray(
      HEADER_BYTES + IV_LENGTH_BYTES + 4,
      HEADER_BYTES + IV_LENGTH_BYTES + 4 + ciphertextLen
    );

    const aesKey = await getAesKey();
    let plaintextBuffer: ArrayBuffer;
    try {
      plaintextBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as unknown as BufferSource,
          additionalData: buildHeader(version) as unknown as BufferSource,
          tagLength: GCM_TAG_BITS,
        },
        aesKey,
        ciphertext as unknown as BufferSource
      );
    } catch (e) {
      throw new Error(`Could not decrypt .bsplit file: ${(e as Error).message}`);
    }

    return decodePayload(new Uint8Array(plaintextBuffer), version);
  }
}

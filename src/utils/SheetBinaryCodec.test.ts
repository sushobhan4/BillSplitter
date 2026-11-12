import { describe, it, expect } from 'vitest';
import { SheetBinaryCodec } from './SheetBinaryCodec';
import type { SheetExportData } from '../types/models';
import { ITEM_TYPE } from '../types/models';

function sampleData(isReadOnly = false): SheetExportData {
  const created = 1_760_000_000_000;
  const modified = 1_760_000_123_000;
  return {
    sheet: {
      sheetID: 42,
      sheetName: 'Goa Trip Secret',
      dateCreated: created,
      dateModified: modified,
      notes: 'Confidential group dinner note',
      isReadOnly,
    },
    contributors: [
      { contributorID: 1, contributorName: 'Shourjo', sheetID: 42 },
      { contributorID: 2, contributorName: 'Aditya', sheetID: 42 },
    ],
    items: [
      {
        itemID: 10,
        sheetID: 42,
        itemName: 'Seafood Platter',
        amount: 1450.75,
        payerID: 1,
        dateCreated: created,
        dateModified: modified,
        notes: 'Paid at Shack',
        itemType: ITEM_TYPE.TYPE_EXPENSE,
      },
      {
        itemID: 11,
        sheetID: 42,
        itemName: 'Aditya paid Shourjo',
        amount: 200.0,
        payerID: 2,
        dateCreated: created,
        dateModified: modified,
        notes: null,
        itemType: ITEM_TYPE.TYPE_SETTLEMENT,
      },
      {
        itemID: 12,
        sheetID: 42,
        itemName: 'Shourjo -> Aditya',
        amount: 100.0,
        payerID: 1,
        dateCreated: created,
        dateModified: modified,
        notes: null,
        itemType: ITEM_TYPE.TYPE_MONEY_TRANSFER,
      },
      {
        itemID: 13,
        sheetID: 42,
        itemName: 'Previous balance',
        amount: 325.5,
        payerID: 1,
        dateCreated: created,
        dateModified: modified,
        notes: 'Carried forward from Prior Trip',
        itemType: ITEM_TYPE.TYPE_CARRYOVER,
      },
    ],
    itemConsumers: [
      { itemID: 10, contributorID: 1, weight: 500.0 },
      { itemID: 10, contributorID: 2, weight: 950.75 },
      { itemID: 11, contributorID: 1, weight: 200.0 },
      { itemID: 12, contributorID: 2, weight: 100.0 },
      { itemID: 13, contributorID: 2, weight: 325.5 },
    ],
  };
}

describe('SheetBinaryCodec', () => {
  it('encodeDecodeRoundTripPreservesAllData', async () => {
    const original = sampleData();
    const encoded = await SheetBinaryCodec.encode(original);
    const decoded = await SheetBinaryCodec.decode(encoded);

    expect(decoded.sheet).toEqual(original.sheet);
    expect(decoded.contributors).toEqual(original.contributors);
    expect(decoded.items).toEqual(original.items);
    expect(decoded.itemConsumers).toEqual(original.itemConsumers);
    expect(decoded.items.find((i) => i.itemID === 13)?.itemType).toBe(
      ITEM_TYPE.TYPE_CARRYOVER
    );
    expect(decoded.sheet.isReadOnly).toBe(false);
  });

  it('readOnlyFlagSurvivesBinaryRoundTrip', async () => {
    const original = sampleData(true);
    const encoded = await SheetBinaryCodec.encode(original);
    const decoded = await SheetBinaryCodec.decode(encoded);

    expect(decoded.sheet.isReadOnly).toBe(true);
    expect(decoded).toEqual(original);
  });

  it('encodedBytesDoNotExposePlaintextAndUseRandomIv', async () => {
    const original = sampleData();
    const first = await SheetBinaryCodec.encode(original);
    const second = await SheetBinaryCodec.encode(original);

    // Random IV means identical data produces different ciphertext envelopes
    let identical = true;
    if (first.length === second.length) {
      for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i]) {
          identical = false;
          break;
        }
      }
    } else {
      identical = false;
    }
    expect(identical).toBe(false);

    const asAscii = new TextDecoder('latin1').decode(first);
    expect(asAscii.includes('Goa Trip Secret')).toBe(false);
    expect(asAscii.includes('Confidential')).toBe(false);
    expect(asAscii.includes('Shourjo')).toBe(false);
    expect(asAscii.includes('Aditya')).toBe(false);
    expect(asAscii.includes('Seafood Platter')).toBe(false);
    expect(asAscii.includes('Paid at Shack')).toBe(false);
  });

  it('tamperedByteFailsSignatureVerification', async () => {
    const encoded = await SheetBinaryCodec.encode(sampleData());
    const indicesToFlip = [0, 6, 10, Math.floor(encoded.length / 2), encoded.length - 1];

    for (const index of indicesToFlip) {
      const corrupted = new Uint8Array(encoded);
      corrupted[index] ^= 0x01;
      let rejected = false;
      try {
        await SheetBinaryCodec.decode(corrupted);
      } catch {
        rejected = true;
      }
      expect(rejected, `Tampered byte at index ${index} must be rejected`).toBe(true);
    }
  });

  it('externalOrShortBytesAreRejected', async () => {
    const arbitrary = new TextEncoder().encode('unencrypted or external file contents');
    let rejected = false;
    try {
      await SheetBinaryCodec.decode(arbitrary);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

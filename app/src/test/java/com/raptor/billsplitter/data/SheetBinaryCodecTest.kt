package com.raptor.billsplitter.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.util.Date

class SheetBinaryCodecTest {

    private fun sampleData(isReadOnly: Boolean = false): SheetExportData {
        val created = Date(1_760_000_000_000L)
        val modified = Date(1_760_000_123_000L)
        val sheet = Sheet(
            sheetID = 42,
            sheetName = "Goa Trip Secret",
            dateCreated = created,
            dateModified = modified,
            notes = "Confidential group dinner note",
            isReadOnly = isReadOnly
        )
        val contributors = listOf(
            Contributor(contributorID = 1, contributorName = "Shourjo", sheetID = 42),
            Contributor(contributorID = 2, contributorName = "Aditya", sheetID = 42)
        )
        val items = listOf(
            Item(
                itemID = 10,
                sheetID = 42,
                itemName = "Seafood Platter",
                amount = 1450.75,
                payerID = 1,
                dateCreated = created,
                dateModified = modified,
                notes = "Paid at Shack",
                itemType = Item.TYPE_EXPENSE
            ),
            Item(
                itemID = 11,
                sheetID = 42,
                itemName = "Aditya paid Shourjo",
                amount = 200.0,
                payerID = 2,
                dateCreated = created,
                dateModified = modified,
                notes = null,
                itemType = Item.TYPE_SETTLEMENT
            ),
            Item(
                itemID = 12,
                sheetID = 42,
                itemName = "Shourjo -> Aditya",
                amount = 100.0,
                payerID = 1,
                dateCreated = created,
                dateModified = modified,
                notes = null,
                itemType = Item.TYPE_MONEY_TRANSFER
            ),
            Item(
                itemID = 13,
                sheetID = 42,
                itemName = "Previous balance",
                amount = 325.50,
                payerID = 1,
                dateCreated = created,
                dateModified = modified,
                notes = "Carried forward from Prior Trip",
                itemType = Item.TYPE_CARRYOVER
            )
        )
        val itemConsumers = listOf(
            ItemConsumer(itemID = 10, contributorID = 1, weight = 500.0),
            ItemConsumer(itemID = 10, contributorID = 2, weight = 950.75),
            ItemConsumer(itemID = 11, contributorID = 1, weight = 200.0),
            ItemConsumer(itemID = 12, contributorID = 2, weight = 100.0),
            ItemConsumer(itemID = 13, contributorID = 2, weight = 325.50)
        )
        return SheetExportData(sheet, contributors, items, itemConsumers)
    }

    @Test
    fun encodeDecodeRoundTripPreservesAllData() {
        val original = sampleData()
        val encoded = SheetBinaryCodec.encode(original)
        val decoded = SheetBinaryCodec.decode(encoded)

        assertEquals(original.sheet, decoded.sheet)
        assertEquals(original.contributors, decoded.contributors)
        assertEquals(original.items, decoded.items)
        assertEquals(original.itemConsumers, decoded.itemConsumers)
        assertEquals(
            Item.TYPE_CARRYOVER,
            decoded.items.first { it.itemID == 13 }.itemType
        )
        assertFalse(decoded.sheet.isReadOnly)
    }

    @Test
    fun readOnlyFlagSurvivesBinaryRoundTrip() {
        val original = sampleData(isReadOnly = true)
        val encoded = SheetBinaryCodec.encode(original)
        val decoded = SheetBinaryCodec.decode(encoded)

        assertTrue(decoded.sheet.isReadOnly)
        assertEquals(original, decoded)
    }

    @Test
    fun encodedBytesDoNotExposePlaintextAndUseRandomIv() {
        val original = sampleData()
        val first = SheetBinaryCodec.encode(original)
        val second = SheetBinaryCodec.encode(original)

        assertFalse(first.contentEquals(second))

        val asAscii = String(first, StandardCharsets.ISO_8859_1)
        assertFalse(asAscii.contains("Goa Trip Secret"))
        assertFalse(asAscii.contains("Confidential"))
        assertFalse(asAscii.contains("Shourjo"))
        assertFalse(asAscii.contains("Aditya"))
        assertFalse(asAscii.contains("Seafood Platter"))
        assertFalse(asAscii.contains("Paid at Shack"))
    }

    @Test
    fun tamperedByteFailsSignatureVerification() {
        val encoded = SheetBinaryCodec.encode(sampleData())
        val indicesToFlip = listOf(0, 6, 10, encoded.size / 2, encoded.size - 1)

        for (index in indicesToFlip) {
            val corrupted = encoded.copyOf()
            corrupted[index] = (corrupted[index].toInt() xor 0x01).toByte()
            var rejected = false
            try {
                SheetBinaryCodec.decode(corrupted)
            } catch (_: SecurityException) {
                rejected = true
            } catch (_: IllegalArgumentException) {
                rejected = true
            }
            assertTrue("Tampered byte at index $index must be rejected", rejected)
        }
    }

    @Test
    fun externalOrShortBytesAreRejected() {
        val arbitrary = "unencrypted or external file contents".toByteArray(StandardCharsets.UTF_8)
        var rejected = false
        try {
            SheetBinaryCodec.decode(arbitrary)
        } catch (_: Exception) {
            rejected = true
        }
        assertTrue(rejected)
    }
}

package com.raptor.billsplitter.data

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Date
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object SheetBinaryCodec {
    private const val MAGIC = 0x4253504C // "BSPL"
    private const val VERSION_V2 = 2
    private const val VERSION_V3 = 3
    private const val VERSION = 4
    private const val IV_LENGTH_BYTES = 12
    private const val GCM_TAG_BITS = 128
    private const val GCM_TAG_BYTES = GCM_TAG_BITS / 8
    private const val SIGNATURE_LENGTH_BYTES = 32
    private const val HEADER_BYTES = 8 // MAGIC (4) + VERSION (4)
    private const val MIN_ENVELOPE_BYTES =
        HEADER_BYTES + IV_LENGTH_BYTES + 4 + GCM_TAG_BYTES + SIGNATURE_LENGTH_BYTES
    private const val MAX_RECORDS = 100_000
    private const val MAX_PAYLOAD_BYTES = 64 * 1024 * 1024

    private val secureRandom = SecureRandom()

    private val seedMaskA = byteArrayOf(
        0x4b.toByte(), 0x91.toByte(), 0x2c.toByte(), 0xe7.toByte(),
        0x18.toByte(), 0x6f.toByte(), 0xb3.toByte(), 0x05.toByte(),
        0xd4.toByte(), 0x7a.toByte(), 0x39.toByte(), 0xc2.toByte(),
        0x5e.toByte(), 0x80.toByte(), 0xf1.toByte(), 0x16.toByte(),
        0x9d.toByte(), 0x24.toByte(), 0x63.toByte(), 0xab.toByte(),
        0x0c.toByte(), 0xef.toByte(), 0x48.toByte(), 0x71.toByte(),
        0xd9.toByte(), 0x32.toByte(), 0x85.toByte(), 0x1a.toByte(),
        0xc7.toByte(), 0x50.toByte(), 0x6e.toByte(), 0xbe.toByte()
    )

    private val seedMaskB = byteArrayOf(
        0x19.toByte(), 0xc4.toByte(), 0x7f.toByte(), 0x38.toByte(),
        0x6d.toByte(), 0xa2.toByte(), 0x51.toByte(), 0xe9.toByte(),
        0x04.toByte(), 0xb8.toByte(), 0x62.toByte(), 0x1d.toByte(),
        0xf3.toByte(), 0x47.toByte(), 0x90.toByte(), 0x2b.toByte(),
        0xce.toByte(), 0x56.toByte(), 0x11.toByte(), 0x7c.toByte(),
        0x8a.toByte(), 0x35.toByte(), 0xd0.toByte(), 0x9f.toByte(),
        0x26.toByte(), 0x64.toByte(), 0xe1.toByte(), 0x43.toByte(),
        0x9b.toByte(), 0x0e.toByte(), 0x77.toByte(), 0x55.toByte()
    )

    fun encode(data: SheetExportData): ByteArray {
        val plaintext = encodePayload(data)
        val iv = ByteArray(IV_LENGTH_BYTES).also { secureRandom.nextBytes(it) }
        val header = buildHeader()

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, deriveAesKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(header)
        val ciphertext = cipher.doFinal(plaintext)

        val body = ByteArrayOutputStream(HEADER_BYTES + IV_LENGTH_BYTES + 4 + ciphertext.size)
        DataOutputStream(body).use { out ->
            out.write(header)
            out.write(iv)
            out.writeInt(ciphertext.size)
            out.write(ciphertext)
        }
        val unsignedEnvelope = body.toByteArray()
        val signature = computeSignature(unsignedEnvelope)

        return ByteArrayOutputStream(unsignedEnvelope.size + signature.size).apply {
            write(unsignedEnvelope)
            write(signature)
        }.toByteArray()
    }

    fun decode(bytes: ByteArray): SheetExportData {
        require(bytes.size >= MIN_ENVELOPE_BYTES) {
            "Invalid or corrupted .bsplit file."
        }

        val signedContentLength = bytes.size - SIGNATURE_LENGTH_BYTES
        val actualSignature = bytes.copyOfRange(signedContentLength, bytes.size)
        val expectedSignature = computeSignature(bytes, 0, signedContentLength)
        if (!MessageDigest.isEqual(expectedSignature, actualSignature)) {
            throw SecurityException("Invalid signature: this .bsplit file was modified or is not from Bill Splitter.")
        }

        val input = DataInputStream(ByteArrayInputStream(bytes, 0, signedContentLength))
        val magic = input.readInt()
        val version = input.readInt()
        require(magic == MAGIC && version in VERSION_V2..VERSION) {
            "Unsupported or invalid .bsplit file."
        }

        val iv = ByteArray(IV_LENGTH_BYTES)
        input.readFully(iv)

        val ciphertextLen = input.readInt()
        val expectedCiphertextLen = signedContentLength - HEADER_BYTES - IV_LENGTH_BYTES - 4
        require(ciphertextLen in GCM_TAG_BYTES..MAX_PAYLOAD_BYTES && ciphertextLen == expectedCiphertextLen) {
            "Invalid or corrupted .bsplit payload."
        }

        val ciphertext = ByteArray(ciphertextLen)
        input.readFully(ciphertext)

        val plaintext = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, deriveAesKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.updateAAD(buildHeader(version))
            cipher.doFinal(ciphertext)
        } catch (e: GeneralSecurityException) {
            throw SecurityException("Could not decrypt .bsplit file.", e)
        }

        return decodePayload(plaintext, version)
    }

    private fun buildHeader(version: Int = VERSION): ByteArray {
        return ByteBuffer.allocate(HEADER_BYTES)
            .putInt(MAGIC)
            .putInt(version)
            .array()
    }

    private fun deriveMaterial(domain: Int): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(domain.toByte())
        for (i in seedMaskA.indices) {
            val mixed = (seedMaskA[i].toInt() xor seedMaskB[(i * 7 + domain) % seedMaskB.size].toInt())
                .plus(i * 13 + domain)
            digest.update(mixed.toByte())
        }
        return digest.digest()
    }

    private fun deriveAesKey(): SecretKeySpec {
        return SecretKeySpec(deriveMaterial(0x3A), "AES")
    }

    private fun deriveSigningKey(): SecretKeySpec {
        return SecretKeySpec(deriveMaterial(0x7C), "HmacSHA256")
    }

    private fun computeSignature(data: ByteArray, offset: Int = 0, length: Int = data.size): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(deriveSigningKey())
        mac.update(data, offset, length)
        return mac.doFinal()
    }

    private fun encodePayload(data: SheetExportData): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            writeSheet(out, data.sheet)

            out.writeInt(data.contributors.size)
            data.contributors.sortedBy { it.contributorID }.forEach { writeContributor(out, it) }

            out.writeInt(data.items.size)
            data.items.sortedBy { it.itemID }.forEach { writeItem(out, it) }

            out.writeInt(data.itemConsumers.size)
            data.itemConsumers.sortedWith(compareBy({ it.itemID }, { it.contributorID }))
                .forEach { writeItemConsumer(out, it) }
        }
        return bytes.toByteArray()
    }

    private fun decodePayload(plaintext: ByteArray, version: Int): SheetExportData {
        DataInputStream(ByteArrayInputStream(plaintext)).use { input ->
            val sheet = readSheet(input, version)
            val contributors = readCountedList(input) { readContributor(input) }
            val items = readCountedList(input) { readItem(input, version) }
            val itemConsumers = readCountedList(input) { readItemConsumer(input) }
            require(input.available() == 0) { "Invalid or corrupted .bsplit payload." }
            return SheetExportData(sheet, contributors, items, itemConsumers)
        }
    }

    private fun writeSheet(out: DataOutputStream, sheet: Sheet) {
        out.writeInt(sheet.sheetID)
        out.writeString(sheet.sheetName)
        out.writeLong(sheet.dateCreated.time)
        out.writeLong(sheet.dateModified.time)
        out.writeNullableString(sheet.notes)
        out.writeBoolean(sheet.isReadOnly)
    }

    private fun readSheet(input: DataInputStream, version: Int): Sheet {
        return Sheet(
            sheetID = input.readInt(),
            sheetName = input.readString(),
            dateCreated = Date(input.readLong()),
            dateModified = Date(input.readLong()),
            notes = input.readNullableString(),
            isReadOnly = if (version >= VERSION) input.readBoolean() else false
        )
    }

    private fun writeContributor(out: DataOutputStream, contributor: Contributor) {
        out.writeInt(contributor.contributorID)
        out.writeString(contributor.contributorName)
        out.writeInt(contributor.sheetID)
    }

    private fun readContributor(input: DataInputStream): Contributor {
        return Contributor(
            contributorID = input.readInt(),
            contributorName = input.readString(),
            sheetID = input.readInt()
        )
    }

    private fun writeItem(out: DataOutputStream, item: Item) {
        out.writeInt(item.itemID)
        out.writeInt(item.sheetID)
        out.writeString(item.itemName)
        out.writeDouble(item.amount)
        out.writeInt(item.payerID)
        out.writeLong(item.dateCreated.time)
        out.writeLong(item.dateModified.time)
        out.writeNullableString(item.notes)
        out.writeInt(item.itemType)
    }

    private fun readItem(input: DataInputStream, version: Int): Item {
        return Item(
            itemID = input.readInt(),
            sheetID = input.readInt(),
            itemName = input.readString(),
            amount = input.readDouble(),
            payerID = input.readInt(),
            dateCreated = Date(input.readLong()),
            dateModified = Date(input.readLong()),
            notes = input.readNullableString(),
            itemType = if (version >= VERSION_V3) input.readInt() else Item.TYPE_EXPENSE
        )
    }

    private fun writeItemConsumer(out: DataOutputStream, itemConsumer: ItemConsumer) {
        out.writeInt(itemConsumer.itemID)
        out.writeInt(itemConsumer.contributorID)
        out.writeDouble(itemConsumer.weight)
    }

    private fun readItemConsumer(input: DataInputStream): ItemConsumer {
        return ItemConsumer(
            itemID = input.readInt(),
            contributorID = input.readInt(),
            weight = input.readDouble()
        )
    }

    private fun <T> readCountedList(input: DataInputStream, reader: () -> T): List<T> {
        val count = input.readInt()
        require(count in 0..MAX_RECORDS) { "The sheet file appears to be corrupted." }
        return List(count) { reader() }
    }

    private fun DataOutputStream.writeString(value: String) {
        val encoded = value.toByteArray(StandardCharsets.UTF_8)
        writeInt(encoded.size)
        write(encoded)
    }

    private fun DataInputStream.readString(): String {
        val size = readInt()
        require(size in 0..1_000_000) { "The sheet file contains invalid text." }
        val encoded = ByteArray(size)
        readFully(encoded)
        return String(encoded, StandardCharsets.UTF_8)
    }

    private fun DataOutputStream.writeNullableString(value: String?) {
        writeBoolean(value != null)
        if (value != null) writeString(value)
    }

    private fun DataInputStream.readNullableString(): String? {
        return if (readBoolean()) readString() else null
    }
}

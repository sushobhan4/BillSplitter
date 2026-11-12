package com.raptor.billsplitter.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey
import java.util.Date

@Entity(
    tableName = "items",
    foreignKeys = [
        ForeignKey(
            entity = Sheet::class,
            parentColumns = ["sheetID"],
            childColumns = ["sheetID"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = Contributor::class,
            parentColumns = ["contributorID"],
            childColumns = ["payerID"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class Item(
    @PrimaryKey(autoGenerate = true)
    val itemID: Int = 0,
    val sheetID: Int,
    val itemName: String,
    val amount: Double,
    val payerID: Int,
    val dateCreated: Date,
    val dateModified: Date,
    val notes: String?,
    val itemType: Int = TYPE_EXPENSE
) {
    companion object {
        const val TYPE_EXPENSE = 0
        const val TYPE_SETTLEMENT = 1
        const val TYPE_MONEY_TRANSFER = 2
        const val TYPE_CARRYOVER = 3
    }
}

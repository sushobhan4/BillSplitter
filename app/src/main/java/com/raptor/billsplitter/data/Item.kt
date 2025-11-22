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
    val notes: String?
)

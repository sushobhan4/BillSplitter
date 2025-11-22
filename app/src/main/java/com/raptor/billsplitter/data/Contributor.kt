package com.raptor.billsplitter.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey

@Entity(
    tableName = "contributors",
    foreignKeys = [
        ForeignKey(
            entity = Sheet::class,
            parentColumns = ["sheetID"],
            childColumns = ["sheetID"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class Contributor(
    @PrimaryKey(autoGenerate = true)
    val contributorID: Int = 0,
    val contributorName: String,
    val sheetID: Int
)

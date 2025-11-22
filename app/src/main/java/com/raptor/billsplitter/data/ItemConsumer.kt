package com.raptor.billsplitter.data

import androidx.room.Entity
import androidx.room.ForeignKey

@Entity(
    tableName = "item_consumers",
    primaryKeys = ["itemID", "contributorID"],
    foreignKeys = [
        ForeignKey(
            entity = Item::class,
            parentColumns = ["itemID"],
            childColumns = ["itemID"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = Contributor::class,
            parentColumns = ["contributorID"],
            childColumns = ["contributorID"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class ItemConsumer(
    val itemID: Int,
    val contributorID: Int,
    val weight: Double
)

package com.raptor.billsplitter.data

import androidx.room.Embedded
import androidx.room.Relation

data class ItemWithPayer(
    @Embedded val item: Item,
    @Relation(
        parentColumn = "payerID",
        entityColumn = "contributorID"
    )
    val payer: Contributor
)

package com.raptor.billsplitter.data

import androidx.room.Embedded
import androidx.room.Junction
import androidx.room.Relation

data class ItemWithPayerAndConsumers(
    @Embedded val item: Item,
    @Relation(
        parentColumn = "payerID",
        entityColumn = "contributorID"
    )
    val payer: Contributor,
    @Relation(
        parentColumn = "itemID",
        entityColumn = "contributorID",
        associateBy = Junction(ItemConsumer::class)
    )
    val consumers: List<Contributor>
)

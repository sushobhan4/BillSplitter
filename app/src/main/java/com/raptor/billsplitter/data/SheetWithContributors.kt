package com.raptor.billsplitter.data

import androidx.room.Embedded
import androidx.room.Relation

data class SheetWithContributors(
    @Embedded val sheet: Sheet,
    @Relation(
        parentColumn = "sheetID",
        entityColumn = "sheetID"
    )
    val contributors: List<Contributor>
)

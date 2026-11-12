package com.raptor.billsplitter.data

data class SheetExportData(
    val sheet: Sheet,
    val contributors: List<Contributor>,
    val items: List<Item>,
    val itemConsumers: List<ItemConsumer> // Crucial: holds the split weights
)

package com.raptor.billsplitter.data

import java.io.Serializable
import java.util.Date

data class CardItem(
    val title: String,
    val contributors: List<String>,
    val dateCreated : Date,
    var dateModified: Date,
    val expenses: MutableList<ExpenseItem> = mutableListOf()
) : Serializable

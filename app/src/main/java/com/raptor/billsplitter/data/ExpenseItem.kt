package com.raptor.billsplitter.data

import java.io.Serializable

data class ExpenseItem(
    val itemName: String,
    val amount: Double,
    val paidBy: String,
    val contributors: Map<String, Double>
) : Serializable
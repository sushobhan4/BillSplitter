package com.raptor.billsplitter.data

import java.util.Locale
import kotlin.math.abs
import kotlin.math.round

data class CarryoverTransfer(
    val creditorId: Int,
    val debtorId: Int,
    val amount: Double
)

data class SettlementTransfer(
    val fromName: String,
    val toName: String,
    val amount: Double
)

object BalanceCalculator {

    private const val EPSILON = 0.005

    fun calculateNetBalancesById(
        contributors: List<Contributor>,
        items: List<Item>,
        itemConsumers: List<ItemConsumer>
    ): Map<Int, Double> {
        val balances = mutableMapOf<Int, Double>()
        for (c in contributors) {
            balances[c.contributorID] = 0.0
        }

        val consumersByItem = itemConsumers.groupBy { it.itemID }

        for (item in items) {
            val amount = item.amount
            if (amount <= 0.0) continue

            val payerId = item.payerID
            val consumersForItem = consumersByItem[item.itemID].orEmpty()

            if (consumersForItem.isEmpty()) {
                balances[payerId] = (balances[payerId] ?: 0.0) + amount
                continue
            }

            val useWeighted = consumersForItem.size > 1 && run {
                val firstWeight = consumersForItem.first().weight
                !consumersForItem.all { abs(it.weight - firstWeight) < 0.01 }
            }

            if (useWeighted) {
                val sumWeights = consumersForItem.sumOf { it.weight }
                if (sumWeights > 0.0) {
                    consumersForItem.forEach { ic ->
                        val share = (ic.weight / sumWeights) * amount
                        balances[ic.contributorID] = (balances[ic.contributorID] ?: 0.0) - share
                    }
                } else {
                    val share = amount / consumersForItem.size
                    consumersForItem.forEach { ic ->
                        balances[ic.contributorID] = (balances[ic.contributorID] ?: 0.0) - share
                    }
                }
            } else {
                val share = amount / consumersForItem.size
                consumersForItem.forEach { ic ->
                    balances[ic.contributorID] = (balances[ic.contributorID] ?: 0.0) - share
                }
            }

            balances[payerId] = (balances[payerId] ?: 0.0) + amount
        }

        return balances.mapValues { (_, v) ->
            val rounded = roundToPlaces(v, 2)
            if (abs(rounded) < EPSILON) 0.0 else rounded
        }
    }

    /**
     * Generates minimal debtor -> creditor carryover entries such that inside the new sheet,
     * [creditorId] acts as payer and [debtorId] acts as sole consumer, reproducing the exact net balances.
     */
    fun generateCarryoverTransfers(netBalancesById: Map<Int, Double>): List<CarryoverTransfer> {
        val creditors = netBalancesById
            .filter { it.value >= EPSILON }
            .map { it.key to it.value }
            .sortedByDescending { it.second }
            .toMutableList()
        val debtors = netBalancesById
            .filter { it.value <= -EPSILON }
            .map { it.key to abs(it.value) }
            .sortedByDescending { it.second }
            .toMutableList()

        val transfers = mutableListOf<CarryoverTransfer>()
        var cIdx = 0
        var dIdx = 0

        while (cIdx < creditors.size && dIdx < debtors.size) {
            val (creditorId, creditRemaining) = creditors[cIdx]
            val (debtorId, debtRemaining) = debtors[dIdx]

            val transferAmount = roundToPlaces(minOf(creditRemaining, debtRemaining), 2)
            if (transferAmount >= EPSILON) {
                transfers.add(CarryoverTransfer(creditorId, debtorId, transferAmount))
            }

            val nextCredit = roundToPlaces(creditRemaining - transferAmount, 2)
            val nextDebt = roundToPlaces(debtRemaining - transferAmount, 2)

            if (nextCredit < EPSILON) {
                cIdx++
            } else {
                creditors[cIdx] = creditorId to nextCredit
            }

            if (nextDebt < EPSILON) {
                dIdx++
            } else {
                debtors[dIdx] = debtorId to nextDebt
            }
        }

        return transfers
    }

    /**
     * Generates a minimal list of 1-to-1 settlement transfers ("Who Pays Whom")
     * from net balances where positive = will receive and negative = will give.
     */
    fun generateSettlementTransfers(netBalances: Map<String, Double>): List<SettlementTransfer> {
        data class Entry(val name: String, var cents: Long)

        val creditors = netBalances
            .filter { it.value >= EPSILON }
            .map { Entry(it.key, kotlin.math.round(it.value * 100.0).toLong()) }
            .filter { it.cents > 0L }
            .sortedWith(compareByDescending<Entry> { it.cents }.thenBy { it.name.lowercase() })
            .toMutableList()

        val debtors = netBalances
            .filter { it.value <= -EPSILON }
            .map { Entry(it.key, kotlin.math.round(abs(it.value) * 100.0).toLong()) }
            .filter { it.cents > 0L }
            .sortedWith(compareByDescending<Entry> { it.cents }.thenBy { it.name.lowercase() })
            .toMutableList()

        val transfers = mutableListOf<SettlementTransfer>()

        // Pass 1: Exact 1-to-1 matches first to minimize split payments
        for (debtor in debtors) {
            if (debtor.cents <= 0L) continue
            val exactCreditor = creditors.firstOrNull { it.cents == debtor.cents }
            if (exactCreditor != null) {
                transfers.add(
                    SettlementTransfer(
                        fromName = debtor.name,
                        toName = exactCreditor.name,
                        amount = debtor.cents / 100.0
                    )
                )
                debtor.cents = 0L
                exactCreditor.cents = 0L
            }
        }

        // Pass 2: Greedy largest-to-largest matching for remaining balances
        val remCreditors = creditors.filter { it.cents > 0L }.toMutableList()
        val remDebtors = debtors.filter { it.cents > 0L }.toMutableList()

        var cIdx = 0
        var dIdx = 0
        while (cIdx < remCreditors.size && dIdx < remDebtors.size) {
            val creditor = remCreditors[cIdx]
            val debtor = remDebtors[dIdx]
            val transferCents = minOf(creditor.cents, debtor.cents)
            if (transferCents > 0L) {
                transfers.add(
                    SettlementTransfer(
                        fromName = debtor.name,
                        toName = creditor.name,
                        amount = transferCents / 100.0
                    )
                )
                creditor.cents -= transferCents
                debtor.cents -= transferCents
            }
            if (creditor.cents <= 0L) cIdx++
            if (debtor.cents <= 0L) dIdx++
        }

        return transfers
    }

    /**
     * Groups all receivers (`> 0.005`) first (largest first), followed by all givers (`< -0.005`)
     * (largest owed first), followed by settled-up members.
     */
    fun sortBalanceEntries(balances: Map<String, Double>): List<Map.Entry<String, Double>> {
        return balances.entries.sortedWith(
            compareBy<Map.Entry<String, Double>>(
                { entry ->
                    when {
                        entry.value > EPSILON -> 0
                        entry.value < -EPSILON -> 1
                        else -> 2
                    }
                },
                { entry ->
                    when {
                        entry.value > EPSILON -> -entry.value
                        entry.value < -EPSILON -> entry.value
                        else -> 0.0
                    }
                },
                { entry -> entry.key.lowercase(Locale.getDefault()) }
            )
        )
    }

    fun roundToPlaces(value: Double, places: Int = 2): Double {
        var factor = 1.0
        repeat(places) { factor *= 10.0 }
        return round(value * factor) / factor
    }
}

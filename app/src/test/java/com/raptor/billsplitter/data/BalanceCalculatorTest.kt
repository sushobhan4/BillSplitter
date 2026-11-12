package com.raptor.billsplitter.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date
import kotlin.math.abs

class BalanceCalculatorTest {

    @Test
    fun carryoverExcludesSettledContributorsAndPreservesUnsettledBalances() {
        val now = Date(1_700_000_000_000L)
        val contributors = listOf(
            Contributor(contributorID = 1, contributorName = "Alice", sheetID = 1),
            Contributor(contributorID = 2, contributorName = "Bob", sheetID = 1),
            Contributor(contributorID = 3, contributorName = "Charlie", sheetID = 1),
            Contributor(contributorID = 4, contributorName = "Dana", sheetID = 1)
        )
        // Alice pays 300 split equally between Alice, Bob, Charlie -> Alice +200, Bob -100, Charlie -100, Dana 0
        // Bob pays Charlie 50 -> actually let's make Dana settled (pays 50 for Dana -> 0), Charlie pays 50 for Bob -> no let's just do:
        // Expense 1: Alice pays 300 for Alice, Bob, Charlie -> Alice +200, Bob -100, Charlie -100
        // Settlement 1: Bob pays Alice 50 -> Alice +150, Bob -50, Charlie -100, Dana 0
        val items = listOf(
            Item(10, 1, "Dinner", 300.0, payerID = 1, now, now, null, Item.TYPE_EXPENSE),
            Item(11, 1, "Partial", 50.0, payerID = 2, now, now, null, Item.TYPE_SETTLEMENT)
        )
        val itemConsumers = listOf(
            ItemConsumer(10, 1, 100.0),
            ItemConsumer(10, 2, 100.0),
            ItemConsumer(10, 3, 100.0),
            ItemConsumer(11, 1, 50.0)
        )

        val netBalances = BalanceCalculator.calculateNetBalancesById(contributors, items, itemConsumers)
        assertEquals(150.0, netBalances[1] ?: -999.0, 0.01)
        assertEquals(-50.0, netBalances[2] ?: -999.0, 0.01)
        assertEquals(-100.0, netBalances[3] ?: -999.0, 0.01)
        assertEquals(0.0, netBalances[4] ?: -999.0, 0.01)

        val unsettledOnly = netBalances.filterValues { abs(it) >= 0.005 }
        assertFalse(unsettledOnly.containsKey(4))
        assertTrue(unsettledOnly.containsKey(1))
        assertTrue(unsettledOnly.containsKey(2))
        assertTrue(unsettledOnly.containsKey(3))

        val transfers = BalanceCalculator.generateCarryoverTransfers(unsettledOnly)
        val newContributors = contributors.filter { unsettledOnly.containsKey(it.contributorID) }
        val newItems = transfers.mapIndexed { idx, t ->
            Item(100 + idx, 2, "Previous balance", t.amount, t.creditorId, now, now, null, Item.TYPE_CARRYOVER)
        }
        val newConsumers = transfers.mapIndexed { idx, t ->
            ItemConsumer(100 + idx, t.debtorId, t.amount)
        }

        val recomputed = BalanceCalculator.calculateNetBalancesById(newContributors, newItems, newConsumers)
        assertEquals(150.0, recomputed[1] ?: -999.0, 0.01)
        assertEquals(-50.0, recomputed[2] ?: -999.0, 0.01)
        assertEquals(-100.0, recomputed[3] ?: -999.0, 0.01)
    }

    @Test
    fun carryoverSupportsMultipleCreditorsAndMultipleDebtors() {
        val now = Date(1_700_000_000_000L)
        val netBalances = mapOf(
            1 to 120.0,
            2 to 80.0,
            3 to -150.0,
            4 to -50.0
        )

        val transfers = BalanceCalculator.generateCarryoverTransfers(netBalances)
        val contributors = netBalances.keys.map { id -> Contributor(id, "User$id", 10) }
        val items = transfers.mapIndexed { idx, t ->
            Item(200 + idx, 10, "Previous balance", t.amount, t.creditorId, now, now, null, Item.TYPE_CARRYOVER)
        }
        val consumers = transfers.mapIndexed { idx, t ->
            ItemConsumer(200 + idx, t.debtorId, t.amount)
        }

        val recomputed = BalanceCalculator.calculateNetBalancesById(contributors, items, consumers)
        assertEquals(120.0, recomputed[1] ?: -999.0, 0.01)
        assertEquals(80.0, recomputed[2] ?: -999.0, 0.01)
        assertEquals(-150.0, recomputed[3] ?: -999.0, 0.01)
        assertEquals(-50.0, recomputed[4] ?: -999.0, 0.01)
    }

    @Test
    fun settlementPlanMatchesTenPersonMultiCreditorAndMultiDebtorScenario() {
        val initialBalances = mapOf(
            "Suso" to 2835.90,
            "Aritra" to -284.10,
            "Jagannath" to -484.10,
            "Soham" to -304.10,
            "Apurba" to 386.90,
            "Ankit" to -484.10,
            "Amit" to -444.10,
            "Debanjan" to -254.10,
            "Subhadip" to -484.10,
            "Swaraj" to -484.10
        )

        val transfers = BalanceCalculator.generateSettlementTransfers(initialBalances)
        assertTrue(transfers.isNotEmpty())
        assertTrue(transfers.all { it.amount > 0.0 && it.fromName != it.toName })

        // Apply all transfers to initial balances and verify everyone reaches 0.00
        val mutable = initialBalances.toMutableMap()
        transfers.forEach { t ->
            mutable[t.fromName] = BalanceCalculator.roundToPlaces((mutable[t.fromName] ?: 0.0) + t.amount, 2)
            mutable[t.toName] = BalanceCalculator.roundToPlaces((mutable[t.toName] ?: 0.0) - t.amount, 2)
        }
        mutable.forEach { (name, bal) ->
            assertEquals("$name should be settled to 0", 0.0, bal, 0.01)
        }
    }

    @Test
    fun settlementPlanPrioritizesExactAmountMatches() {
        val balances = mapOf(
            "Alice" to 150.0,
            "Bob" to 100.0,
            "Cam" to -100.0,
            "Dan" to -150.0
        )
        val transfers = BalanceCalculator.generateSettlementTransfers(balances)
        assertEquals(2, transfers.size)
        assertTrue(transfers.any { it.fromName == "Dan" && it.toName == "Alice" && abs(it.amount - 150.0) < 0.01 })
        assertTrue(transfers.any { it.fromName == "Cam" && it.toName == "Bob" && abs(it.amount - 100.0) < 0.01 })
    }

    @Test
    fun sortBalanceEntriesPlacesAllReceiversBeforeAllGivers() {
        val mixed = linkedMapOf(
            "Aritra" to -284.10,
            "Suso" to 2835.90,
            "Jagannath" to -484.10,
            "Zero" to 0.0,
            "Apurba" to 386.90,
            "Debanjan" to -254.10
        )

        val sorted = BalanceCalculator.sortBalanceEntries(mixed)
        assertEquals(
            listOf("Suso", "Apurba", "Jagannath", "Aritra", "Debanjan", "Zero"),
            sorted.map { it.key }
        )
    }
}

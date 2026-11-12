package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.withTransaction
import com.raptor.billsplitter.data.AppDatabase
import com.raptor.billsplitter.data.BalanceCalculator
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.Item
import com.raptor.billsplitter.data.ItemConsumer
import com.raptor.billsplitter.data.Sheet
import com.raptor.billsplitter.data.SheetExportData
import com.raptor.billsplitter.data.SheetWithContributorsAndItems
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Date
import kotlin.math.abs

class MainViewModel(private val database: AppDatabase) : ViewModel() {

    private val dao = database.billSplitterDao()

    val sheets: Flow<List<SheetWithContributorsAndItems>> = dao.getSheetsWithContributorsAndItems()

    fun addSheet(sheetName: String, notes: String?, contributorNames: List<String>) {
        viewModelScope.launch {
            val now = Date()
            val newSheet = Sheet(
                sheetName = sheetName,
                dateCreated = now,
                dateModified = now,
                notes = notes
            )
            val sheetId = dao.insertSheet(newSheet).toInt()

            val contributors = contributorNames.map {
                Contributor(contributorName = it, sheetID = sheetId)
            }
            dao.insertContributors(contributors)
        }
    }

    fun updateSheet(sheetId: Int, sheetName: String, notes: String?, contributorsToUpdate: Map<Int, String>) {
        viewModelScope.launch {
            if (dao.getSheetSnapshot(sheetId)?.isReadOnly == true) return@launch
            dao.updateSheetDetails(sheetId, sheetName, notes, Date())
            updateContributors(sheetId, contributorsToUpdate)
        }
    }

    private suspend fun updateContributors(sheetId: Int, newContributors: Map<Int, String>) {
        val existingContributors = dao.getContributorsForSheet(sheetId).first()

        val toDelete = existingContributors.filter { it.contributorID !in newContributors.keys }
        val toAdd = newContributors.filter { it.key <= 0 }
        val toUpdate = newContributors.filter { it.key > 0 }

        for (contributor in toDelete) {
            val payerCount = dao.getPayerUsageCount(contributor.contributorID)
            val consumerCount = dao.getConsumerUsageCount(contributor.contributorID)
            if (payerCount == 0 && consumerCount == 0) {
                dao.deleteContributors(listOf(contributor))
            }
        }

        if (toAdd.isNotEmpty()) {
            val newContributorEntities = toAdd.map { Contributor(contributorName = it.value, sheetID = sheetId) }
            dao.insertContributors(newContributorEntities)
        }

        for ((id, name) in toUpdate) {
            dao.updateContributorName(id, name)
        }
    }

    fun deleteSheet(sheetId: Int) {
        viewModelScope.launch {
            dao.deleteSheet(sheetId)
        }
    }

    suspend fun getExportData(sheetId: Int): SheetExportData? = withContext(Dispatchers.IO) {
        val sheet = dao.getSheetSnapshot(sheetId) ?: return@withContext null
        SheetExportData(
            sheet = sheet,
            contributors = dao.getContributorsForSheetSnapshot(sheetId),
            items = dao.getItemsForSheetSnapshot(sheetId),
            itemConsumers = dao.getItemConsumersForSheetSnapshot(sheetId)
        )
    }

    suspend fun importSheet(exportData: SheetExportData): Int = withContext(Dispatchers.IO) {
        database.withTransaction {
            val newSheetId = dao.insertSheet(exportData.sheet.copy(sheetID = 0)).toInt()
            val contributorIdMap = mutableMapOf<Int, Int>()
            val itemIdMap = mutableMapOf<Int, Int>()

            exportData.contributors.sortedBy { it.contributorID }.forEach { contributor ->
                val newContributorId = dao.insertContributor(
                    contributor.copy(contributorID = 0, sheetID = newSheetId)
                ).toInt()
                contributorIdMap[contributor.contributorID] = newContributorId
            }

            exportData.items.sortedBy { it.itemID }.forEach { item ->
                val newPayerId = contributorIdMap[item.payerID]
                    ?: throw IllegalArgumentException("The sheet file is missing a payer.")
                val newItemId = dao.insertItem(
                    item.copy(itemID = 0, sheetID = newSheetId, payerID = newPayerId)
                ).toInt()
                itemIdMap[item.itemID] = newItemId
            }

            val remappedConsumers = exportData.itemConsumers.map { itemConsumer ->
                val newItemId = itemIdMap[itemConsumer.itemID]
                    ?: throw IllegalArgumentException("The sheet file is missing an expense.")
                val newContributorId = contributorIdMap[itemConsumer.contributorID]
                    ?: throw IllegalArgumentException("The sheet file is missing a contributor.")
                ItemConsumer(newItemId, newContributorId, itemConsumer.weight)
            }
            if (remappedConsumers.isNotEmpty()) {
                dao.insertItemConsumers(remappedConsumers)
            }

            newSheetId
        }
    }

    suspend fun getNonZeroCarryoverBalances(sheetId: Int): Map<Int, Double> = withContext(Dispatchers.IO) {
        val contributors = dao.getContributorsForSheetSnapshot(sheetId)
        val items = dao.getItemsForSheetSnapshot(sheetId)
        val itemConsumers = dao.getItemConsumersForSheetSnapshot(sheetId)
        BalanceCalculator.calculateNetBalancesById(contributors, items, itemConsumers)
            .filterValues { abs(it) >= 0.005 }
    }

    suspend fun addClonedSheetWithBalances(
        sheetName: String,
        notes: String?,
        contributorsWithBalance: List<Pair<String, Double>>,
        sourceSheetName: String
    ): Int = withContext(Dispatchers.IO) {
        database.withTransaction {
            val now = Date()
            val newSheetId = dao.insertSheet(
                Sheet(
                    sheetName = sheetName,
                    dateCreated = now,
                    dateModified = now,
                    notes = notes
                )
            ).toInt()

            val balanceByNewContributorId = mutableMapOf<Int, Double>()
            contributorsWithBalance.forEach { (name, carriedBalance) ->
                val newContributorId = dao.insertContributor(
                    Contributor(contributorName = name, sheetID = newSheetId)
                ).toInt()
                if (abs(carriedBalance) >= 0.005) {
                    balanceByNewContributorId[newContributorId] = carriedBalance
                }
            }

            val carryoverTransfers = BalanceCalculator.generateCarryoverTransfers(balanceByNewContributorId)
            val carryNote = if (sourceSheetName.isNotBlank()) {
                "Carried forward from $sourceSheetName"
            } else {
                "Carried forward balance"
            }
            carryoverTransfers.forEach { transfer ->
                val itemId = dao.insertItem(
                    Item(
                        sheetID = newSheetId,
                        itemName = "Previous balance",
                        amount = transfer.amount,
                        payerID = transfer.creditorId,
                        dateCreated = now,
                        dateModified = now,
                        notes = carryNote,
                        itemType = Item.TYPE_CARRYOVER
                    )
                ).toInt()
                dao.insertItemConsumers(
                    listOf(
                        ItemConsumer(
                            itemID = itemId,
                            contributorID = transfer.debtorId,
                            weight = transfer.amount
                        )
                    )
                )
            }

            newSheetId
        }
    }
}

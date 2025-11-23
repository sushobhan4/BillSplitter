package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raptor.billsplitter.data.BillSplitterDao
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.Sheet
import com.raptor.billsplitter.data.SheetWithContributorsAndItems
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.Date

class MainViewModel(private val dao: BillSplitterDao) : ViewModel() {

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
}

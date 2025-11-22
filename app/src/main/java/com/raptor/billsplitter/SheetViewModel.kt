package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raptor.billsplitter.data.BillSplitterDao
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.Item
import com.raptor.billsplitter.data.ItemConsumer
import com.raptor.billsplitter.data.ItemWithPayerAndConsumers
import com.raptor.billsplitter.data.Sheet
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import java.util.Date

class SheetViewModel(private val dao: BillSplitterDao, private val sheetId: Int) : ViewModel() {

    val items: Flow<List<ItemWithPayerAndConsumers>> = dao.getItemsWithPayerAndConsumers(sheetId)
    val contributors: Flow<List<Contributor>> = dao.getContributorsForSheet(sheetId)
    val sheet: Flow<Sheet> = dao.getSheet(sheetId)

    fun getItemConsumers(itemId: Int): Flow<List<ItemConsumer>> {
        return dao.getItemConsumers(itemId)
    }

    fun insertItem(
        itemName: String,
        amount: Double,
        payerId: Int,
        sheetId: Int,
        date: Date,
        consumers: List<Int>,
        consumerWeights: List<Pair<Int, Double>>,
        notes: String?
    ) {
        viewModelScope.launch {
            val newItem = Item(
                sheetID = sheetId,
                itemName = itemName,
                amount = amount,
                payerID = payerId,
                dateCreated = date,
                dateModified = date,
                notes = notes
            )
            val itemId = dao.insertItem(newItem).toInt()

            val itemConsumers = consumerWeights.map {
                ItemConsumer(itemId, it.first, it.second)
            }
            dao.insertItemConsumers(itemConsumers)
            dao.updateSheetDateModified(sheetId, Date())
        }
    }

    fun updateItem(
        itemId: Int,
        itemName: String,
        amount: Double,
        payerId: Int,
        consumers: List<Int>,
        consumerWeights: List<Pair<Int, Double>>,
        notes: String?
    ) {
        viewModelScope.launch {
            dao.updateItemDetails(itemId, itemName, amount, payerId, Date(), notes)
            dao.deleteItemConsumersByItemId(itemId)
            val itemConsumers = consumerWeights.map {
                ItemConsumer(itemId, it.first, it.second)
            }
            dao.insertItemConsumers(itemConsumers)
            dao.updateSheetDateModified(sheetId, Date())
        }
    }

    fun deleteItem(itemId: Int) {
        viewModelScope.launch {
            dao.deleteItemConsumersByItemId(itemId)
            dao.deleteItem(itemId)
            dao.updateSheetDateModified(sheetId, Date())
        }
    }
}

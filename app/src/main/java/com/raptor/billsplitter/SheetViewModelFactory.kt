package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.raptor.billsplitter.data.BillSplitterDao

class SheetViewModelFactory(private val dao: BillSplitterDao, private val sheetId: Int) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(SheetViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return SheetViewModel(dao, sheetId) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}

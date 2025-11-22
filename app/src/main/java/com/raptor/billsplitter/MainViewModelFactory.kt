package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.raptor.billsplitter.data.BillSplitterDao

class MainViewModelFactory(private val dao: BillSplitterDao) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MainViewModel(dao) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}

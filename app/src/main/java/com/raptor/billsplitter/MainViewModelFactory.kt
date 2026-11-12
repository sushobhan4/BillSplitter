package com.raptor.billsplitter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.raptor.billsplitter.data.AppDatabase

class MainViewModelFactory(private val database: AppDatabase) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MainViewModel(database) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}

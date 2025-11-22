package com.raptor.billsplitter.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

@Entity(tableName = "sheets")
data class Sheet(
    @PrimaryKey(autoGenerate = true)
    val sheetID: Int = 0,
    val sheetName: String,
    val dateCreated: Date,
    var dateModified: Date,
    val notes: String?
)

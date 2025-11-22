package com.raptor.billsplitter.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import java.util.Date

@Dao
interface BillSplitterDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSheet(sheet: Sheet): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertContributor(contributor: Contributor): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertContributors(contributors: List<Contributor>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItem(item: Item): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItemConsumers(itemConsumers: List<ItemConsumer>)

    @Query("SELECT * FROM sheets ORDER BY dateModified DESC")
    fun getSheets(): Flow<List<Sheet>>

    @Transaction
    @Query("SELECT * FROM sheets ORDER BY dateModified DESC")
    fun getSheetsWithContributors(): Flow<List<SheetWithContributors>>

    @Transaction
    @Query("SELECT * FROM sheets WHERE sheetID = :sheetId")
    fun getSheetWithContributors(sheetId: Int): Flow<SheetWithContributors>

    @Query("SELECT * FROM contributors WHERE sheetID = :sheetId")
    fun getContributorsForSheet(sheetId: Int): Flow<List<Contributor>>

    @Query("SELECT COUNT(*) FROM items WHERE payerID = :contributorId")
    suspend fun getPayerUsageCount(contributorId: Int): Int

    @Query("SELECT COUNT(*) FROM item_consumers WHERE contributorID = :contributorId")
    suspend fun getConsumerUsageCount(contributorId: Int): Int

    @Delete
    suspend fun deleteContributors(contributors: List<Contributor>)

    @Query("DELETE FROM contributors WHERE sheetID = :sheetId")
    suspend fun deleteContributorsBySheetId(sheetId: Int)

    @Query("SELECT * FROM items WHERE sheetID = :sheetId ORDER BY dateModified DESC")
    fun getItemsForSheet(sheetId: Int): Flow<List<Item>>

    @Transaction
    @Query("SELECT * FROM items WHERE sheetID = :sheetId ORDER BY dateModified DESC")
    fun getItemsWithPayerAndConsumers(sheetId: Int): Flow<List<ItemWithPayerAndConsumers>>

    @Query("SELECT * FROM item_consumers WHERE itemID = :itemId")
    fun getItemConsumers(itemId: Int): Flow<List<ItemConsumer>>

    @Query("DELETE FROM items WHERE itemID = :itemId")
    suspend fun deleteItem(itemId: Int)

    @Query("DELETE FROM item_consumers WHERE itemID = :itemId")
    suspend fun deleteItemConsumersByItemId(itemId: Int)

    @Query("DELETE FROM sheets WHERE sheetID = :sheetId")
    suspend fun deleteSheet(sheetId: Int)

    @Query("UPDATE sheets SET sheetName = :sheetName, notes = :notes, dateModified = :date WHERE sheetID = :sheetId")
    suspend fun updateSheetDetails(sheetId: Int, sheetName: String, notes: String?, date: Date)

    @Query("UPDATE contributors SET contributorName = :name WHERE contributorID = :id")
    suspend fun updateContributorName(id: Int, name: String)

    @Query("SELECT * FROM sheets WHERE sheetID = :sheetId")
    fun getSheet(sheetId: Int): Flow<Sheet>

    @Query("UPDATE items SET itemName = :itemName, amount = :amount, payerID = :payerId, dateModified = :dateModified, notes = :notes WHERE itemID = :itemId")
    suspend fun updateItemDetails(itemId: Int, itemName: String, amount: Double, payerId: Int, dateModified: Date, notes: String?)

    @Query("UPDATE sheets SET dateModified = :date WHERE sheetID = :sheetId")
    suspend fun updateSheetDateModified(sheetId: Int, date: Date)
}

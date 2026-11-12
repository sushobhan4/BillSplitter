package com.raptor.billsplitter

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.graphics.drawable.toDrawable
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.switchmaterial.SwitchMaterial
import com.raptor.billsplitter.data.AppDatabase
import com.raptor.billsplitter.data.BalanceCalculator
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.Item
import com.raptor.billsplitter.data.ItemConsumer
import com.raptor.billsplitter.data.ItemWithPayerAndConsumers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

class SheetViewActivity : AppCompatActivity() {

    private lateinit var expenseRecyclerView: RecyclerView
    private lateinit var expenseAdapter: ExpenseAdapter
    private lateinit var tvSheetName: TextView
    private lateinit var tvEmptyExpenses: TextView
    private lateinit var btnAddItem: Button
    private lateinit var tvReadOnlyBadge: TextView
    private var sheetId: Int = -1
    private var isSheetReadOnly: Boolean = false
    private lateinit var sharedPreferences: android.content.SharedPreferences
    private lateinit var viewModel: SheetViewModel
    private var allItems: List<ItemWithPayerAndConsumers> = emptyList()
    private var currentSearchQuery: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.sheet_view)

        sheetId = intent.getIntExtra("SHEET_ID", -1)
        if (sheetId == -1) {
            finish()
            return
        }

        // initialize prefs and viewModel after sheetId is known
        sharedPreferences = getSharedPreferences("BillSplitterPrefs_Sheet_$sheetId", Context.MODE_PRIVATE)
        viewModel = ViewModelProvider(
            this,
            SheetViewModelFactory(AppDatabase.getDatabase(this).billSplitterDao(), sheetId)
        ).get(SheetViewModel::class.java)

        // TEMPORARY: run one-time repair to sync DB consumers with UI consumers (remove after running once)
        lifecycleScope.launch {
            try {
                repairConsumerMismatches()
            } catch (e: Exception) {
                Log.e("CalcBalances", "repairConsumerMismatches failed: ${e.message}")
            }
        }

        val sheetRoot = findViewById<ViewGroup>(R.id.sheetRoot)
        tvSheetName = findViewById(R.id.tv_sheet_name)
        val btnCalculate: Button = findViewById(R.id.btn_calculate)
        btnAddItem = findViewById(R.id.btn_add_item)
        tvReadOnlyBadge = findViewById(R.id.tvReadOnlyBadge)
        val btnBack: ImageButton = findViewById(R.id.btn_back_sheet)
        val btnSort: ImageButton = findViewById(R.id.btn_sort_expenses)
        val tvTotalSpent: TextView = findViewById(R.id.tv_total_spent)
        expenseRecyclerView = findViewById(R.id.rv_expenses)
        tvEmptyExpenses = findViewById(R.id.tv_empty_expenses)
        val etSearchExpenses: EditText = findViewById(R.id.etSearchExpenses)
        val btnClearExpenseSearch: ImageButton = findViewById(R.id.btnClearExpenseSearch)
        expenseRecyclerView.layoutManager = LinearLayoutManager(this)

        etSearchExpenses.doAfterTextChanged { text ->
            currentSearchQuery = text?.toString().orEmpty()
            UiSizing.setVisibilityMorph(
                btnClearExpenseSearch,
                if (currentSearchQuery.isNotEmpty()) View.VISIBLE else View.GONE
            )
            applySortingAndSubmit(allItems)
        }

        btnClearExpenseSearch.setOnClickListener {
            etSearchExpenses.setText("")
        }

        expenseAdapter = ExpenseAdapter(this) { action, item ->
            when (action) {
                "EDIT" -> {
                    if (isSheetReadOnly) {
                        Toast.makeText(this, "This sheet is read-only.", Toast.LENGTH_SHORT).show()
                        return@ExpenseAdapter
                    }
                    lifecycleScope.launch {
                        val contributorsSnapshot = viewModel.contributors.first()
                        if (item.item.itemType == Item.TYPE_EXPENSE || item.item.itemType == Item.TYPE_CARRYOVER) {
                            showAddExpenseDialog(contributorsSnapshot, item)
                        } else {
                            showMoneyTransferDialog(contributorsSnapshot, item)
                        }
                    }
                }
                "DELETE" -> {
                    if (isSheetReadOnly) {
                        Toast.makeText(this, "This sheet is read-only.", Toast.LENGTH_SHORT).show()
                        return@ExpenseAdapter
                    }
                    showDeleteItemWarningDialog(item)
                }
                "DETAILS" -> showExpenseDetailsDialog(item)
            }
        }
        expenseRecyclerView.adapter = expenseAdapter

        expenseAdapter.registerAdapterDataObserver(object : RecyclerView.AdapterDataObserver() {
            override fun onItemRangeInserted(positionStart: Int, itemCount: Int) {
                super.onItemRangeInserted(positionStart, itemCount)
                expenseRecyclerView.smoothScrollToPosition(positionStart)
            }
        })

        lifecycleScope.launch {
            viewModel.sheet.collect { sheet ->
                tvSheetName.text = sheet.sheetName
                val readOnlyChanged = isSheetReadOnly != sheet.isReadOnly
                isSheetReadOnly = sheet.isReadOnly
                expenseAdapter.setReadOnly(isSheetReadOnly)
                val targetAddVis = if (isSheetReadOnly) View.GONE else View.VISIBLE
                val targetBadgeVis = if (isSheetReadOnly) View.VISIBLE else View.GONE
                if (btnAddItem.visibility != targetAddVis || tvReadOnlyBadge.visibility != targetBadgeVis || readOnlyChanged) {
                    UiSizing.animateMorph(sheetRoot)
                    btnAddItem.visibility = targetAddVis
                    btnAddItem.isEnabled = !isSheetReadOnly
                    btnAddItem.isClickable = !isSheetReadOnly
                    btnAddItem.isLongClickable = !isSheetReadOnly
                    tvReadOnlyBadge.visibility = targetBadgeVis
                }
            }
        }

        lifecycleScope.launch {
            viewModel.items.collectLatest { items ->
                allItems = items
                val targetSortVis = if (items.size >= 2) View.VISIBLE else View.GONE
                val targetCalcVis = if (items.isNotEmpty()) View.VISIBLE else View.GONE
                if (btnSort.visibility != targetSortVis || btnCalculate.visibility != targetCalcVis) {
                    UiSizing.animateMorph(sheetRoot)
                    btnSort.visibility = targetSortVis
                    btnCalculate.visibility = targetCalcVis
                }
                val totalSpent = items
                    .filter { it.item.itemType == Item.TYPE_EXPENSE }
                    .sumOf { it.item.amount }
                tvTotalSpent.text = String.format(Locale.getDefault(), "\u20B9%,.2f", totalSpent)
                applySortingAndSubmit(items)
            }
        }

        btnAddItem.setOnClickListener {
            if (isSheetReadOnly) return@setOnClickListener
            lifecycleScope.launch {
                val contributorsSnapshot = viewModel.contributors.first()
                showAddExpenseDialog(contributorsSnapshot, null)
            }
        }
        btnAddItem.isLongClickable = true
        btnAddItem.setOnLongClickListener { view ->
            if (isSheetReadOnly) return@setOnLongClickListener true
            showAddExpenseOptionsPopup(view)
            true
        }

        btnCalculate.setOnClickListener {
            lifecycleScope.launch {
                calculateBalances()
            }
        }

        btnBack.setOnClickListener {
            finish()
        }

        btnSort.setOnClickListener {
            showSortDialog()
        }
    }

    private fun showDeleteItemWarningDialog(item: ItemWithPayerAndConsumers) {
        if (isSheetReadOnly) return
        val formattedAmount = String.format(Locale.getDefault(), "\u20B9%,.2f", item.item.amount)
        val (title, message, toastText) = when (item.item.itemType) {
            Item.TYPE_SETTLEMENT -> Triple(
                "Delete payment?",
                "Are you sure you want to delete payment \"${item.item.itemName}\" ($formattedAmount)? Sheet balances will be recalculated.",
                "Payment deleted"
            )
            Item.TYPE_MONEY_TRANSFER -> Triple(
                "Delete money transfer?",
                "Are you sure you want to delete transfer \"${item.item.itemName}\" ($formattedAmount)? Sheet balances will be recalculated.",
                "Money transfer deleted"
            )
            Item.TYPE_CARRYOVER -> Triple(
                "Delete carried balance?",
                "Are you sure you want to delete carried balance \"${item.item.itemName}\" ($formattedAmount)? Carried balances from the previous sheet will change.",
                "Carried balance deleted"
            )
            else -> Triple(
                "Delete expense?",
                "Are you sure you want to delete \"${item.item.itemName}\" ($formattedAmount)? Sheet balances will be recalculated.",
                "Expense deleted"
            )
        }

        UiSizing.showConfirmDialog(
            context = this,
            title = title,
            message = message,
            confirmText = "Delete"
        ) {
            viewModel.deleteItem(item.item.itemID)
            Toast.makeText(this, toastText, Toast.LENGTH_SHORT).show()
        }
    }

    private fun applySortingAndSubmit(items: List<ItemWithPayerAndConsumers>) {
        val query = currentSearchQuery.trim()
        val filteredItems = if (query.isEmpty()) {
            items
        } else {
            items.filter { item ->
                item.item.itemName.contains(query, ignoreCase = true) ||
                    (item.item.notes?.contains(query, ignoreCase = true) == true) ||
                    item.payer.contributorName.contains(query, ignoreCase = true) ||
                    item.consumers.any { it.contributorName.contains(query, ignoreCase = true) } ||
                    String.format(Locale.getDefault(), "%.2f", item.item.amount).contains(query, ignoreCase = true)
            }
        }

        val sortBy = sharedPreferences.getInt("sortBy", R.id.rbDateModified)
        val sortOrder = sharedPreferences.getInt("sortOrder", R.id.rbDescending)
        val isAscending = sortOrder == R.id.rbAscending

        val sortedList = when (sortBy) {
            R.id.rbName -> {
                if (isAscending) filteredItems.sortedBy { it.item.itemName.lowercase(Locale.getDefault()) }
                else filteredItems.sortedByDescending { it.item.itemName.lowercase(Locale.getDefault()) }
            }
            R.id.rbAmount -> {
                if (isAscending) filteredItems.sortedBy { it.item.amount }
                else filteredItems.sortedByDescending { it.item.amount }
            }
            R.id.rbDateCreated -> {
                if (isAscending) filteredItems.sortedBy { it.item.dateCreated }
                else filteredItems.sortedByDescending { it.item.dateCreated }
            }
            R.id.rbDateModified -> {
                if (isAscending) filteredItems.sortedBy { it.item.dateModified }
                else filteredItems.sortedByDescending { it.item.dateModified }
            }
            else -> filteredItems
        }

        val showEmpty = allItems.isEmpty() || sortedList.isEmpty()
        val targetListVis = if (showEmpty) View.GONE else View.VISIBLE
        val targetEmptyVis = if (showEmpty) View.VISIBLE else View.GONE
        if (expenseRecyclerView.visibility != targetListVis || tvEmptyExpenses.visibility != targetEmptyVis) {
            UiSizing.animateMorph(findViewById(R.id.sheetRoot))
            expenseRecyclerView.visibility = targetListVis
            tvEmptyExpenses.visibility = targetEmptyVis
        }
        if (allItems.isEmpty()) {
            tvEmptyExpenses.text = "Long press expense card to see more options"
        } else if (sortedList.isEmpty()) {
            tvEmptyExpenses.text = "No expenses match your search"
        }
        expenseAdapter.submitList(sortedList)
    }

    private fun showSortDialog() {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_sort_sheet, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        val rgSortBy = dialog.findViewById<RadioGroup>(R.id.rgSortBy)
        val rgSortOrder = dialog.findViewById<RadioGroup>(R.id.rgSortOrder)
        val btnApply = dialog.findViewById<Button>(R.id.btnApplySort)

        val savedSortBy = sharedPreferences.getInt("sortBy", R.id.rbDateModified)
        val savedSortOrder = sharedPreferences.getInt("sortOrder", R.id.rbDescending)
        rgSortBy.check(savedSortBy)
        rgSortOrder.check(savedSortOrder)

        btnApply.setOnClickListener {
            val sortBy = rgSortBy.checkedRadioButtonId
            val sortOrder = rgSortOrder.checkedRadioButtonId

            sharedPreferences.edit {
                putInt("sortBy", sortBy)
                putInt("sortOrder", sortOrder)
            }
            applySortingAndSubmit(allItems)
            dialog.dismiss()
        }

        UiSizing.setDialogWidthFraction(dialog, dialogView, 0.60f)
        dialog.show()
        UiSizing.setDialogWidthFraction(dialog, dialogView, 0.60f)
    }

    private fun showAddExpenseOptionsPopup(anchorView: View) {
        val popupView = LayoutInflater.from(this).inflate(R.layout.popup_add_expense_options, null)
        val popupWidth = UiSizing.measurePopupWidth(popupView)

        val popupWindow = PopupWindow(
            popupView,
            popupWidth,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        ).apply {
            elevation = 8f
            isOutsideTouchable = true
            setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
            UiSizing.applyPopupMorph(this)
        }

        popupView.findViewById<View>(R.id.menuAddExpense).setOnClickListener {
            popupWindow.dismiss()
            lifecycleScope.launch {
                val contributorsSnapshot = viewModel.contributors.first()
                showAddExpenseDialog(contributorsSnapshot, null)
            }
        }

        popupView.findViewById<View>(R.id.menuMoneyTransfer).setOnClickListener {
            popupWindow.dismiss()
            lifecycleScope.launch {
                val contributorsSnapshot = viewModel.contributors.first()
                showMoneyTransferDialog(contributorsSnapshot, null)
            }
        }

        UiSizing.showAnchoredPopup(anchorView, popupWindow, popupWidth, preferAbove = true)
    }

    private suspend fun calculateBalances() {
        val finalBalances = computeBalancesMap()
        Log.d("CalcBalances", "Final balances (pos=receive, neg=owe): $finalBalances")
        showBalancesDialog(finalBalances)
    }

    private suspend fun computeBalancesMap(): Map<String, Double> {
        val TAG = "CalcBalances"
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        val balances = mutableMapOf<String, Double>()
        for (c in contributors) balances[c.contributorName] = 0.0

        for (item in items) {
            val payerName = item.payer.contributorName
            val amount = item.item.amount
            if (amount <= 0.0) continue

            val itemConsumers: List<ItemConsumer> = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers

            val consumerNames: List<String> = if (itemConsumers.isNotEmpty()) {
                itemConsumers.mapNotNull { ic -> contributors.find { it.contributorID == ic.contributorID }?.contributorName }
            } else {
                uiConsumers.map { it.contributorName }
            }

            if (consumerNames.isEmpty()) {
                balances[payerName] = (balances[payerName] ?: 0.0) + amount
                Log.d(TAG, "Item='${item.item.itemName}': no consumers — credited $payerName $amount")
                continue
            }

            val useWeighted = itemConsumers.isNotEmpty() && run {
                if (itemConsumers.size <= 1) false
                else {
                    val first = itemConsumers.first().weight
                    !itemConsumers.all { abs(it.weight - first) < 0.01 }
                }
            }

            val perConsumer = mutableListOf<Pair<String, Double>>()

            if (useWeighted) {
                val sumWeights = itemConsumers.sumOf { it.weight }
                itemConsumers.forEach { ic ->
                    val name = contributors.find { it.contributorID == ic.contributorID }?.contributorName ?: "unknown-${ic.contributorID}"
                    val share = (ic.weight / sumWeights) * amount
                    perConsumer.add(Pair(name, share))
                }
            } else {
                val n = consumerNames.size
                val share = amount / n
                consumerNames.forEach { name -> perConsumer.add(Pair(name, share)) }
            }

            perConsumer.forEach { (name, share) ->
                balances[name] = (balances[name] ?: 0.0) - share
            }

            balances[payerName] = (balances[payerName] ?: 0.0) + amount
        }

        return balances.mapValues { (_, v) ->
            roundToPlaces(v, 2)
        }
    }

    private suspend fun repairConsumerMismatches() {
        if (viewModel.sheet.first().isReadOnly) return
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        for (item in items) {
            val dbConsumers = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers ?: emptyList()

            if (uiConsumers.size > dbConsumers.size) {
                val consumerIds = uiConsumers.map { it.contributorID }
                val n = consumerIds.size
                val equalWeight = if (n > 0) (item.item.amount ?: 0.0) / n else 0.0
                val consumerWeights = consumerIds.map { Pair(it, equalWeight) }

                try {
                    viewModel.updateItem(
                        item.item.itemID,
                        item.item.itemName,
                        item.item.amount,
                        item.payer.contributorID,
                        consumerIds,
                        consumerWeights,
                        item.item.notes
                    )
                } catch (e: Exception) {
                    Log.e("CalcBalances", "Failed to repair item '${item.item.itemName}': ${e.message}")
                }
            }
        }
    }

    private fun roundToPlaces(value: Double, places: Int = 2): Double {
        if (places < 0) throw IllegalArgumentException()
        var factor = 1.0
        repeat(places) { factor *= 10 }
        return kotlin.math.round(value * factor) / factor
    }

    private fun showBalancesDialog(initialBalances: Map<String, Double>) {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_balances, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        val cardRoot = dialog.findViewById<ViewGroup>(R.id.balancesCardRoot)
        val tabBalances = dialog.findViewById<TextView>(R.id.tabBalances)
        val tabSettlePlan = dialog.findViewById<TextView>(R.id.tabSettlePlan)
        val rvBalances = dialog.findViewById<RecyclerView>(R.id.rvBalances)
        val tvBalancesEmpty = dialog.findViewById<TextView>(R.id.tvBalancesEmpty)

        rvBalances.layoutManager = LinearLayoutManager(this)
        UiSizing.constrainChildMaxHeight(this, rvBalances, 0.58f)

        var currentBalances = initialBalances
        var showingSettlePlan = false
        lateinit var balanceAdapter: BalanceAdapter
        lateinit var settlementPlanAdapter: SettlementPlanAdapter

        fun renderActiveTab(animate: Boolean) {
            if (animate) {
                UiSizing.animateMorph(cardRoot)
            }
            if (showingSettlePlan) {
                tabBalances.background = null
                tabBalances.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
                tabSettlePlan.setBackgroundResource(R.drawable.bg_primary_button)
                tabSettlePlan.setTextColor(ContextCompat.getColor(this, R.color.button_primary_text))

                val transfers = BalanceCalculator.generateSettlementTransfers(currentBalances)
                settlementPlanAdapter.updateTransfers(transfers)
                if (rvBalances.adapter !== settlementPlanAdapter) {
                    rvBalances.adapter = settlementPlanAdapter
                }
                val isEmpty = transfers.isEmpty()
                rvBalances.visibility = if (isEmpty) View.GONE else View.VISIBLE
                tvBalancesEmpty.visibility = if (isEmpty) View.VISIBLE else View.GONE
            } else {
                tabSettlePlan.background = null
                tabSettlePlan.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
                tabBalances.setBackgroundResource(R.drawable.bg_primary_button)
                tabBalances.setTextColor(ContextCompat.getColor(this, R.color.button_primary_text))

                balanceAdapter.updateBalances(currentBalances)
                if (rvBalances.adapter !== balanceAdapter) {
                    rvBalances.adapter = balanceAdapter
                }
                rvBalances.visibility = View.VISIBLE
                tvBalancesEmpty.visibility = View.GONE
            }
        }

        suspend fun recordSettlement(
            debtorName: String,
            receiverName: String,
            settlementAmount: Double
        ) {
            if (isSheetReadOnly) return
            val contributors = viewModel.contributors.first()
            val debtor = contributors.find { it.contributorName == debtorName } ?: return
            val receiver = contributors.find { it.contributorName == receiverName } ?: return
            val roundedAmount = roundToPlaces(settlementAmount, 2)
            if (roundedAmount <= 0.0) return

            val job = viewModel.insertItem(
                itemName = "$debtorName paid $receiverName",
                amount = roundedAmount,
                payerId = debtor.contributorID,
                sheetId = sheetId,
                date = Date(),
                consumers = listOf(receiver.contributorID),
                consumerWeights = listOf(Pair(receiver.contributorID, roundedAmount)),
                notes = "Marked as paid",
                itemType = Item.TYPE_SETTLEMENT
            )
            job.join()
            currentBalances = computeBalancesMap()
            renderActiveTab(animate = true)
            Toast.makeText(
                this@SheetViewActivity,
                String.format(Locale.getDefault(), "%s paid %s (\u20B9%,.2f)", debtorName, receiverName, roundedAmount),
                Toast.LENGTH_SHORT
            ).show()
        }

        balanceAdapter = BalanceAdapter(currentBalances, isReadOnly = isSheetReadOnly) { debtorName, amountOwed ->
            if (isSheetReadOnly) return@BalanceAdapter
            val receivers = currentBalances.filter { it.value > 0.005 }.entries.toList()
            when {
                receivers.isEmpty() -> {
                    Toast.makeText(this, "No recipient available to settle.", Toast.LENGTH_SHORT).show()
                }
                receivers.size == 1 -> {
                    val receiverName = receivers[0].key
                    lifecycleScope.launch {
                        recordSettlement(debtorName, receiverName, amountOwed)
                    }
                }
                else -> {
                    showSelectRecipientDialog(debtorName, amountOwed, receivers) { chosenReceiver, chosenAmount ->
                        lifecycleScope.launch {
                            recordSettlement(debtorName, chosenReceiver, chosenAmount)
                        }
                    }
                }
            }
        }

        settlementPlanAdapter = SettlementPlanAdapter(
            BalanceCalculator.generateSettlementTransfers(currentBalances),
            isReadOnly = isSheetReadOnly
        ) { transfer ->
            if (isSheetReadOnly) return@SettlementPlanAdapter
            lifecycleScope.launch {
                recordSettlement(transfer.fromName, transfer.toName, transfer.amount)
            }
        }

        tabBalances.setOnClickListener {
            if (showingSettlePlan) {
                showingSettlePlan = false
                renderActiveTab(animate = true)
            }
        }

        tabSettlePlan.setOnClickListener {
            if (!showingSettlePlan) {
                showingSettlePlan = true
                renderActiveTab(animate = true)
            }
        }

        renderActiveTab(animate = false)
        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }

    private fun showSelectRecipientDialog(
        debtorName: String,
        amountOwed: Double,
        receivers: List<Map.Entry<String, Double>>,
        onRecipientSelected: (receiverName: String, amount: Double) -> Unit
    ) {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_select_recipient, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)
        val svRecipients = dialog.findViewById<View>(R.id.svRecipientsContainer)
        UiSizing.constrainChildMaxHeight(this, svRecipients, 0.55f)

        dialog.findViewById<TextView>(R.id.tvRecipientPromptTitle).text = "Who did $debtorName pay?"
        dialog.findViewById<TextView>(R.id.tvRecipientPromptSubtitle).text =
            String.format(Locale.getDefault(), "Total to pay: \u20B9%,.2f", amountOwed)

        val container = dialog.findViewById<LinearLayout>(R.id.llRecipientsContainer)
        receivers.forEach { (receiverName, receiverOwed) ->
            val payAmount = roundToPlaces(minOf(amountOwed, receiverOwed), 2)
            val row = LayoutInflater.from(this).inflate(R.layout.balance_item, container, false)
            row.findViewById<TextView>(R.id.tvContributorName).text = receiverName
            val tvBalance = row.findViewById<TextView>(R.id.tvBalance)
            tvBalance.text = String.format(Locale.getDefault(), "Pay \u20B9%,.2f (owed \u20B9%,.2f)", payAmount, receiverOwed)
            tvBalance.setTextColor(ContextCompat.getColor(this, R.color.settlement_accent))
            row.setOnClickListener {
                dialog.dismiss()
                onRecipientSelected(receiverName, payAmount)
            }
            container.addView(row)
        }

        dialog.findViewById<Button>(R.id.btnCancelRecipient).setOnClickListener {
            dialog.dismiss()
        }

        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }

    private fun showMoneyTransferDialog(
        contributorsSnapshot: List<Contributor>,
        itemToEdit: ItemWithPayerAndConsumers?
    ) {
        if (isSheetReadOnly) return
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_money_transfer, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        val tvTitle = dialog.findViewById<TextView>(R.id.tvTransferDialogTitle)
        val etAmount = dialog.findViewById<EditText>(R.id.et_transfer_amount)
        val spinnerFrom = dialog.findViewById<Spinner>(R.id.spinner_transfer_from)
        val spinnerTo = dialog.findViewById<Spinner>(R.id.spinner_transfer_to)
        val btnCancel = dialog.findViewById<Button>(R.id.btn_transfer_cancel)
        val btnSave = dialog.findViewById<Button>(R.id.btn_transfer_save)

        tvTitle.text = when (itemToEdit?.item?.itemType) {
            Item.TYPE_SETTLEMENT -> "Edit Payment"
            Item.TYPE_MONEY_TRANSFER -> "Edit Money Transfer"
            else -> "Money Transfer"
        }

        val sortedContributors = contributorsSnapshot.sortedBy { it.contributorName.lowercase(Locale.getDefault()) }

        var selectedFromId: Int? = itemToEdit?.payer?.contributorID
        var selectedToId: Int? = itemToEdit?.consumers?.firstOrNull()?.contributorID

        var fromCandidates: List<Contributor> = sortedContributors.filter { it.contributorID != selectedToId }
        var toCandidates: List<Contributor> = sortedContributors.filter { it.contributorID != selectedFromId }

        fun buildPersonSpinnerAdapter(initialItems: MutableList<String>): ArrayAdapter<String> {
            return object : ArrayAdapter<String>(this@SheetViewActivity, R.layout.spinner_item, initialItems) {
                override fun isEnabled(position: Int): Boolean = position != 0
                override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val view = super.getDropDownView(position, convertView, parent)
                    val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                    val colorRes = if (position == 0) R.color.text_hint else R.color.text_primary
                    tv?.setTextColor(ContextCompat.getColor(this@SheetViewActivity, colorRes))
                    return view
                }
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val view = super.getView(position, convertView, parent)
                    val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                    val colorRes = if (position == 0) R.color.text_hint else R.color.text_primary
                    tv?.setTextColor(ContextCompat.getColor(this@SheetViewActivity, colorRes))
                    return view
                }
            }.apply {
                setDropDownViewResource(R.layout.spinner_dropdown_item)
            }
        }

        val fromItems = mutableListOf("From").apply { addAll(fromCandidates.map { it.contributorName }) }
        val toItems = mutableListOf("To").apply { addAll(toCandidates.map { it.contributorName }) }
        val fromAdapter = buildPersonSpinnerAdapter(fromItems)
        val toAdapter = buildPersonSpinnerAdapter(toItems)

        spinnerFrom.adapter = fromAdapter
        spinnerTo.adapter = toAdapter

        fun refreshToSpinner() {
            toCandidates = sortedContributors.filter { it.contributorID != selectedFromId }
            toItems.clear()
            toItems.add("To")
            toItems.addAll(toCandidates.map { it.contributorName })
            toAdapter.notifyDataSetChanged()
            val toPos = if (selectedToId == null) 0 else {
                toCandidates.indexOfFirst { it.contributorID == selectedToId }.let { if (it >= 0) it + 1 else 0 }
            }
            if (toPos == 0) selectedToId = null
            spinnerTo.setSelection(toPos, false)
        }

        fun refreshFromSpinner() {
            fromCandidates = sortedContributors.filter { it.contributorID != selectedToId }
            fromItems.clear()
            fromItems.add("From")
            fromItems.addAll(fromCandidates.map { it.contributorName })
            fromAdapter.notifyDataSetChanged()
            val fromPos = if (selectedFromId == null) 0 else {
                fromCandidates.indexOfFirst { it.contributorID == selectedFromId }.let { if (it >= 0) it + 1 else 0 }
            }
            if (fromPos == 0) selectedFromId = null
            spinnerFrom.setSelection(fromPos, false)
        }

        if (itemToEdit != null) {
            etAmount.setText(String.format(Locale.US, "%.2f", itemToEdit.item.amount))
            val fromIdx = fromCandidates.indexOfFirst { it.contributorID == selectedFromId }
            spinnerFrom.setSelection(if (fromIdx >= 0) fromIdx + 1 else 0, false)
            val toIdx = toCandidates.indexOfFirst { it.contributorID == selectedToId }
            spinnerTo.setSelection(if (toIdx >= 0) toIdx + 1 else 0, false)
        } else {
            spinnerFrom.setSelection(0, false)
            spinnerTo.setSelection(0, false)
        }

        spinnerFrom.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val pickedId = if (position <= 0) null else fromCandidates.getOrNull(position - 1)?.contributorID
                if (pickedId == selectedFromId) return
                selectedFromId = pickedId
                refreshToSpinner()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        spinnerTo.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val pickedId = if (position <= 0) null else toCandidates.getOrNull(position - 1)?.contributorID
                if (pickedId == selectedToId) return
                selectedToId = pickedId
                refreshFromSpinner()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        btnCancel.setOnClickListener { dialog.dismiss() }

        btnSave.setOnClickListener {
            val amount = etAmount.text.toString().trim().toDoubleOrNull()
            if (amount == null || amount <= 0.0) {
                etAmount.error = "Invalid amount."
                return@setOnClickListener
            }
            val fromContributor = sortedContributors.find { it.contributorID == selectedFromId }
            if (fromContributor == null) {
                Toast.makeText(this, "Select who sent the money (From).", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val toContributor = sortedContributors.find { it.contributorID == selectedToId }
            if (toContributor == null) {
                Toast.makeText(this, "Select who received the money (To).", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (fromContributor.contributorID == toContributor.contributorID) {
                Toast.makeText(this, "From and To must be different people.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val itemType = itemToEdit?.item?.itemType ?: Item.TYPE_MONEY_TRANSFER
            val transferTitle = if (itemType == Item.TYPE_SETTLEMENT) {
                "${fromContributor.contributorName} paid ${toContributor.contributorName}"
            } else {
                "${fromContributor.contributorName} → ${toContributor.contributorName}"
            }
            val roundedAmount = roundToPlaces(amount, 2)
            val consumers = listOf(toContributor.contributorID)
            val consumerWeights = listOf(Pair(toContributor.contributorID, roundedAmount))

            if (itemToEdit != null) {
                viewModel.updateItem(
                    itemToEdit.item.itemID,
                    transferTitle,
                    roundedAmount,
                    fromContributor.contributorID,
                    consumers,
                    consumerWeights,
                    itemToEdit.item.notes
                )
            } else {
                viewModel.insertItem(
                    itemName = transferTitle,
                    amount = roundedAmount,
                    payerId = fromContributor.contributorID,
                    sheetId = sheetId,
                    date = Date(),
                    consumers = consumers,
                    consumerWeights = consumerWeights,
                    notes = "Money transfer",
                    itemType = Item.TYPE_MONEY_TRANSFER
                )
            }
            dialog.dismiss()
        }

        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }

    private fun showExpenseDetailsDialog(item: ItemWithPayerAndConsumers) {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_details, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        val tvName = dialog.findViewById<TextView>(R.id.tvName)
        val tvAmount = dialog.findViewById<TextView>(R.id.tvAmount)
        val tvPayer = dialog.findViewById<TextView>(R.id.tvPayer)
        val tvDateCreated = dialog.findViewById<TextView>(R.id.tvDateCreated)
        val tvDateModified = dialog.findViewById<TextView>(R.id.tvDateModified)
        val tvContributors = dialog.findViewById<TextView>(R.id.tvContributors)
        val tvNotes = dialog.findViewById<TextView>(R.id.tvNotes)

        tvAmount.visibility = View.VISIBLE
        tvPayer.visibility = View.VISIBLE

        val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault())

        tvName.text = item.item.itemName
        tvAmount.text = "Amount: ${item.item.amount}"
        tvPayer.text = "Paid by: ${item.payer.contributorName}"
        tvDateCreated.text = "Created: ${sdf.format(item.item.dateCreated)}"
        tvDateModified.text = "Modified: ${sdf.format(item.item.dateModified)}"
        tvContributors.text = item.consumers.joinToString(", ") { it.contributorName }
        tvNotes.text = item.item.notes ?: ""

        UiSizing.fitDialogToContent(dialog, dialogView)
        dialog.show()
        UiSizing.fitDialogToContent(dialog, dialogView)
    }

    private suspend fun showAddExpenseDialog(contributorsSnapshot: List<Contributor>, itemToEdit: ItemWithPayerAndConsumers?) {
        if (isSheetReadOnly) return
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_add_expense, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)
        val dialogRoot = dialogView as? ViewGroup

        val tvDialogTitle = dialog.findViewById<TextView>(R.id.tvDialogTitle)
        if (itemToEdit?.item?.itemType == Item.TYPE_CARRYOVER) {
            tvDialogTitle.text = "Edit Carried Balance"
        }
        val etItemName = dialog.findViewById<EditText>(R.id.et_item_name)
        val etAmount = dialog.findViewById<EditText>(R.id.et_amount) // Main Total Amount
        val etNotes = dialog.findViewById<EditText>(R.id.et_notes)
        val spinnerPayer = dialog.findViewById<Spinner>(R.id.spinner_payer)
        val containerContributors = dialog.findViewById<LinearLayout>(R.id.ll_contributor_checkboxes)
        val btnDone = dialog.findViewById<Button>(R.id.btn_done)
        val btnCancel = dialog.findViewById<Button>(R.id.btn_cancel)
        val btnSelectAll = dialog.findViewById<Button>(R.id.btn_select_all_contributors)
        val switchEqualSplit = dialog.findViewById<SwitchMaterial>(R.id.switch_equal_split)
        val tvPercentageWarning = dialog.findViewById<TextView>(R.id.tv_percentage_warning)

        // Sort contributors ascending
        val sortedContributors = contributorsSnapshot.sortedBy { it.contributorName.lowercase(Locale.getDefault()) }

        // Prepare spinner
        val placeholder = "Paid By"
        val names = sortedContributors.map { it.contributorName }
        val spinnerItems = mutableListOf<String>().apply {
            add(placeholder)
            addAll(names)
        }

        val spinnerAdapter = object : ArrayAdapter<String>(this@SheetViewActivity, R.layout.spinner_item, spinnerItems) {
            override fun isEnabled(position: Int): Boolean = position != 0
            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getDropDownView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                val colorRes = if (position == 0) R.color.text_hint else R.color.text_primary
                tv?.setTextColor(ContextCompat.getColor(this@SheetViewActivity, colorRes))
                return view
            }
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                val colorRes = if (position == 0) R.color.text_hint else R.color.text_primary
                tv?.setTextColor(ContextCompat.getColor(this@SheetViewActivity, colorRes))
                return view
            }
        }
        spinnerAdapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
        spinnerPayer.adapter = spinnerAdapter
        spinnerPayer.setSelection(0)

        val contributorViews = mutableListOf<View>()
        var isUpdatingProgrammatically = false
        // FLAG ARRAY: Tracks if the user has manually entered data for this row
        val manualEntries = BooleanArray(sortedContributors.size) { false }

        containerContributors.removeAllViews()

        // Populate Layouts
        // Logic: if editing, check weights to determine switch state
        var isEditMode = false
        if (itemToEdit != null) {
            isEditMode = true
            etItemName.setText(itemToEdit.item.itemName)
            etAmount.setText(itemToEdit.item.amount.toString())
            etNotes.setText(itemToEdit.item.notes)

            val itemConsumers = viewModel.getItemConsumers(itemToEdit.item.itemID).first()
            val areWeightsEqual = if (itemConsumers.size <= 1) true else {
                val firstWeight = itemConsumers.first().weight
                itemConsumers.all { Math.abs(it.weight - firstWeight) < 0.01 }
            }
            switchEqualSplit.isChecked = areWeightsEqual

            sortedContributors.forEachIndexed { index, contrib ->
                val rowView = LayoutInflater.from(this).inflate(R.layout.contributor_percentage_item, containerContributors, false)
                val cb = rowView.findViewById<CheckBox>(R.id.checkbox_contributor)
                cb.text = contrib.contributorName
                cb.tag = contrib.contributorID
                val consumer = itemConsumers.find { it.contributorID == contrib.contributorID }
                cb.isChecked = consumer != null

                // Populate custom values if unequal
                if (consumer != null && !areWeightsEqual) {
                    val etRowAmount = rowView.findViewById<EditText>(R.id.et_amount)
                    etRowAmount.setText(String.format(Locale.US, "%.2f", consumer.weight))

                    val etPercentage = rowView.findViewById<EditText>(R.id.et_percentage)
                    val percentage = if ((itemToEdit.item.amount ?: 0.0) > 0) {
                        (consumer.weight / (itemToEdit.item.amount ?: 0.0)) * 100.0
                    } else {
                        0.0
                    }
                    etPercentage.setText(String.format(Locale.US, "%.2f", percentage))

                    // Mark as manually entered since we are loading existing data
                    manualEntries[index] = true
                }

                containerContributors.addView(rowView)
                contributorViews.add(rowView)
            }

            val payerIndex = sortedContributors.indexOfFirst { it.contributorID == itemToEdit.payer.contributorID }
            if (payerIndex >= 0) spinnerPayer.setSelection(payerIndex + 1)
        } else {
            for (contrib in sortedContributors) {
                val rowView = LayoutInflater.from(this).inflate(R.layout.contributor_percentage_item, containerContributors, false)
                val cb = rowView.findViewById<CheckBox>(R.id.checkbox_contributor)
                cb.text = contrib.contributorName
                cb.tag = contrib.contributorID
                cb.isChecked = false
                containerContributors.addView(rowView)
                contributorViews.add(rowView)
            }
        }

        fun setProgrammaticUpdate(updating: Boolean) {
            isUpdatingProgrammatically = updating
        }

        fun updateSelectAllButtonText() {
            val hasContributors = contributorViews.isNotEmpty()
            val allSelected = hasContributors && contributorViews.all {
                it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked
            }
            btnSelectAll.text = if (allSelected) "Deselect all" else "Select all"
        }

        // Lock Select/Deselect chip width to its longest label so Equal switch never wraps when toggled
        val previousChipText = btnSelectAll.text
        btnSelectAll.text = "Deselect all"
        val chipMeasureSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        btnSelectAll.measure(chipMeasureSpec, chipMeasureSpec)
        btnSelectAll.minWidth = btnSelectAll.measuredWidth
        btnSelectAll.text = previousChipText

        fun updateUIState(animate: Boolean = true) {
            setProgrammaticUpdate(true)
            if (animate) {
                UiSizing.animateMorph(dialogRoot)
            }
            val isSplitEqually = switchEqualSplit.isChecked
            val totalAmount = etAmount.text.toString().toDoubleOrNull() ?: 0.0

            val checkedViews = contributorViews.filter { it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked }
            val count = checkedViews.size

            for (view in contributorViews) {
                val cb = view.findViewById<CheckBox>(R.id.checkbox_contributor)
                val etPercentage = view.findViewById<EditText>(R.id.et_percentage)
                val tvAmountDisplay = view.findViewById<TextView>(R.id.tv_amount)
                val etRowAmount = view.findViewById<EditText>(R.id.et_amount)

                if (!cb.isChecked) {
                    etPercentage.visibility = View.GONE
                    tvAmountDisplay.visibility = View.GONE
                    etRowAmount.visibility = View.GONE
                    etPercentage.setText("")
                    tvAmountDisplay.text = ""
                    etRowAmount.setText("")
                } else {
                    if (isSplitEqually) {
                        // Equal Split: Show TV, Hide inputs
                        etPercentage.visibility = View.GONE
                        etRowAmount.visibility = View.GONE
                        tvAmountDisplay.visibility = View.VISIBLE

                        if (count > 0 && totalAmount > 0) {
                            val share = totalAmount / count
                            tvAmountDisplay.text = String.format(Locale.US, "%.2f", share)
                        } else {
                            tvAmountDisplay.text = "0.00"
                        }
                    } else {
                        // Custom Split: Show Inputs, Hide TV
                        etPercentage.visibility = View.VISIBLE
                        etRowAmount.visibility = View.VISIBLE
                        tvAmountDisplay.visibility = View.GONE
                    }
                }
            }
            tvPercentageWarning.visibility = View.GONE
            updateSelectAllButtonText()
            setProgrammaticUpdate(false)
        }

        // Listener for Main Amount to update rows in real-time
        etAmount.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if(isUpdatingProgrammatically) return

                // If equal split, just update UI (recalc shares)
                if (switchEqualSplit.isChecked) {
                    updateUIState(animate = false)
                } else {
                    // If custom split, update row AMOUNTS based on existing percentages
                    // We assume percentages are invariant when Total changes
                    setProgrammaticUpdate(true)
                    val newTotal = s.toString().toDoubleOrNull() ?: 0.0
                    val checkedViews = contributorViews.filter { it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked }
                    checkedViews.forEach { view ->
                        val etPerc = view.findViewById<EditText>(R.id.et_percentage)
                        val etRowAmt = view.findViewById<EditText>(R.id.et_amount)
                        val perc = etPerc.text.toString().toDoubleOrNull() ?: 0.0
                        if (perc > 0) {
                            val newAmt = newTotal * (perc / 100.0)
                            etRowAmt.setText(String.format(Locale.US, "%.2f", newAmt))
                        }
                    }
                    setProgrammaticUpdate(false)
                }
            }
        })

        // MAIN LOGIC: Recalculate based on Source Change
        fun distributeAmounts(sourceIndex: Int, currentAmount: Double) {
            val totalAmount = etAmount.text.toString().toDoubleOrNull() ?: 0.0
            if (totalAmount <= 0.001) return

            // 1. Mark this row as Manually Entered
            manualEntries[sourceIndex] = true

            val checkedIndices = contributorViews.indices.filter {
                contributorViews[it].findViewById<CheckBox>(R.id.checkbox_contributor).isChecked
            }

            // 2. Identify Locked vs Floating rows
            // Locked = manually entered. Floating = untouched (candidate for auto-balance).
            // NOTE: The current source row is effectively locked to its new value.
            var lockedIndices = checkedIndices.filter { manualEntries[it] }
            var floatingIndices = checkedIndices.filter { !manualEntries[it] }

            // NEW LOGIC: If ALL are locked, unlock everyone else except current source (the new Anchor)
            if (floatingIndices.isEmpty() && checkedIndices.size > 1) {
                checkedIndices.forEach { idx ->
                    if (idx != sourceIndex) {
                        manualEntries[idx] = false
                    }
                }
                // Refresh lists
                lockedIndices = checkedIndices.filter { manualEntries[it] }
                floatingIndices = checkedIndices.filter { !manualEntries[it] }
            }

            // 3. Calculate what is consumed by locked rows (EXCLUDING targets we might adjust)
            // We sum up the Locked rows.
            // Note: Since we just updated sourceIndex's text/amount in the caller,
            // reading its EditText gives the new value.
            var sumLocked = 0.0
            lockedIndices.forEach { idx ->
                val valStr = contributorViews[idx].findViewById<EditText>(R.id.et_amount).text.toString()
                sumLocked += valStr.toDoubleOrNull() ?: 0.0
            }

            // 4. Calculate Remainder
            var remaining = totalAmount - sumLocked

            // 5. Logic Branch: Do we have floating rows?
            if (floatingIndices.isNotEmpty()) {
                // CASE A: Distribute Remainder to Floating Rows (Initial Fill)
                // If remaining < 0 (Overflow), floating rows get 0, and we still have deficit.

                var amountPerFloating = remaining / floatingIndices.size
                if (amountPerFloating < 0) amountPerFloating = 0.0

                floatingIndices.forEach { idx ->
                    val v = contributorViews[idx]
                    val etAmt = v.findViewById<EditText>(R.id.et_amount)
                    val etPerc = v.findViewById<EditText>(R.id.et_percentage)

                    etAmt.setText(String.format(Locale.US, "%.2f", amountPerFloating))
                    val perc = (amountPerFloating / totalAmount) * 100.0
                    etPerc.setText(String.format(Locale.US, "%.2f", perc))
                }
            }

            // 6. Final Check: Overflow/Underflow Correction (Penny Logic & Over-Locked)
            // We recalculate the Total Sum of ALL checked rows now.
            var currentTotalSum = 0.0
            checkedIndices.forEach { idx ->
                val valStr = contributorViews[idx].findViewById<EditText>(R.id.et_amount).text.toString()
                currentTotalSum += valStr.toDoubleOrNull() ?: 0.0
            }

            val diff = totalAmount - currentTotalSum

            // If there's a difference (either penny rounding, or overflow because everything was locked)
            if (Math.abs(diff) > 0.001) {
                // We need to apply 'diff' to a target row.
                // Priority: A floating row (if existed), else a neighbor.

                val targetIndex = if (floatingIndices.isNotEmpty()) {
                    floatingIndices.last() // Dump pennies on last floating
                } else {
                    // All are locked. We must adjust another locked row to maintain total.
                    // Pick a neighbor that isn't the source.
                    checkedIndices.firstOrNull { it != sourceIndex }
                }

                if (targetIndex != null) {
                    val v = contributorViews[targetIndex]
                    val etAmt = v.findViewById<EditText>(R.id.et_amount)
                    val etPerc = v.findViewById<EditText>(R.id.et_percentage)

                    val oldAmt = etAmt.text.toString().toDoubleOrNull() ?: 0.0
                    var newAmt = oldAmt + diff
                    if (newAmt < 0) newAmt = 0.0 // Clamp to 0

                    etAmt.setText(String.format(Locale.US, "%.2f", newAmt))
                    val newPerc = (newAmt / totalAmount) * 100.0
                    etPerc.setText(String.format(Locale.US, "%.2f", newPerc))
                }
            }
        }

        contributorViews.forEachIndexed { index, view ->
            val cb = view.findViewById<CheckBox>(R.id.checkbox_contributor)
            val etPercentage = view.findViewById<EditText>(R.id.et_percentage)
            val etRowAmount = view.findViewById<EditText>(R.id.et_amount)

            cb.setOnCheckedChangeListener { _, _ ->
                if (!isUpdatingProgrammatically) {
                    updateUIState(animate = true)
                }
            }

            // --- PERCENTAGE TEXT WATCHER ---
            etPercentage.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (isUpdatingProgrammatically) return
                    if (!etPercentage.hasFocus()) return

                    setProgrammaticUpdate(true)
                    val totalAmount = etAmount.text.toString().toDoubleOrNull() ?: 0.0

                    // Update Amount First (Source of Truth)
                    val currentPerc = s.toString().toDoubleOrNull() ?: 0.0
                    val rowAmt = totalAmount * (currentPerc / 100.0)
                    etRowAmount.setText(String.format(Locale.US, "%.2f", rowAmt))

                    // Run Logic based on Amount
                    distributeAmounts(index, rowAmt)

                    setProgrammaticUpdate(false)
                }
            })

            // --- AMOUNT TEXT WATCHER ---
            etRowAmount.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (isUpdatingProgrammatically) return
                    if (!etRowAmount.hasFocus()) return

                    setProgrammaticUpdate(true)
                    val totalAmount = etAmount.text.toString().toDoubleOrNull() ?: 0.0
                    val currentAmt = s.toString().toDoubleOrNull() ?: 0.0

                    // Update Percentage
                    if (totalAmount > 0) {
                        val currentPerc = (currentAmt / totalAmount) * 100.0
                        etPercentage.setText(String.format(Locale.US, "%.2f", currentPerc))
                    }

                    // Run Logic
                    distributeAmounts(index, currentAmt)

                    setProgrammaticUpdate(false)
                }
            })

            // Helper to ensure focus logic works for selection
            etPercentage.setOnFocusChangeListener { _, hasFocus -> if (hasFocus && !isUpdatingProgrammatically) etPercentage.selectAll() }
            etRowAmount.setOnFocusChangeListener { _, hasFocus -> if (hasFocus && !isUpdatingProgrammatically) etRowAmount.selectAll() }
            etPercentage.setOnClickListener { if (!isUpdatingProgrammatically) etPercentage.selectAll() }
            etRowAmount.setOnClickListener { if (!isUpdatingProgrammatically) etRowAmount.selectAll() }
        }

        btnSelectAll.setOnClickListener {
            val shouldSelectAll = contributorViews.any {
                !it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked
            }
            setProgrammaticUpdate(true)
            contributorViews.forEachIndexed { index, view ->
                view.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked = shouldSelectAll
                manualEntries[index] = false
                view.findViewById<EditText>(R.id.et_percentage).setText("")
                view.findViewById<EditText>(R.id.et_amount).setText("")
            }
            setProgrammaticUpdate(false)
            updateUIState(animate = true)
        }

        switchEqualSplit.setOnCheckedChangeListener { _, isChecked ->
            setProgrammaticUpdate(true)
            if (!isChecked) {
                // TRYING TO TURN OFF
                val totalStr = etAmount.text.toString()
                val total = totalStr.toDoubleOrNull()

                if (total == null || total <= 0) {
                    Toast.makeText(this, "Please enter the total Amount before custom splitting.", Toast.LENGTH_SHORT).show()
                    switchEqualSplit.isChecked = true
                    setProgrammaticUpdate(false)
                    return@setOnCheckedChangeListener
                }

                // RESET STATE for Custom Mode
                contributorViews.forEachIndexed { idx, view ->
                    view.findViewById<EditText>(R.id.et_percentage).setText("")
                    view.findViewById<EditText>(R.id.et_amount).setText("")
                    manualEntries[idx] = false // Reset all flags
                }
            }
            setProgrammaticUpdate(false)
            updateUIState(animate = true)
        }

        // Initial State
        updateUIState(animate = false)
        if (!switchEqualSplit.isChecked && !isEditMode) {
            setProgrammaticUpdate(true)
            contributorViews.forEach {
                it.findViewById<EditText>(R.id.et_percentage).setText("")
                it.findViewById<EditText>(R.id.et_amount).setText("")
            }
            manualEntries.fill(false)
            setProgrammaticUpdate(false)
        }

        btnCancel.setOnClickListener { dialog.dismiss() }

        btnDone.setOnClickListener {
            val itemName = etItemName.text.toString().trim()
            val amountStr = etAmount.text.toString().trim()
            val amount = amountStr.toDoubleOrNull()
            val notes = etNotes.text.toString().trim()

            if (itemName.isEmpty()) { etItemName.error = "Item name cannot be empty."; return@setOnClickListener }
            if (amount == null || amount <= 0) { etAmount.error = "Invalid amount."; return@setOnClickListener }
            if (spinnerPayer.selectedItemPosition <= 0) { Toast.makeText(this, "Select a valid payer.", Toast.LENGTH_SHORT).show(); return@setOnClickListener }

            val payerName = spinnerPayer.selectedItem as String
            val payer = contributorsSnapshot.find { it.contributorName == payerName } ?: return@setOnClickListener

            val checkedViews = contributorViews.filter { it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked }
            if (checkedViews.isEmpty()) { Toast.makeText(this, "Select at least one consumer.", Toast.LENGTH_SHORT).show(); return@setOnClickListener }

            val consumerWeights = mutableListOf<Pair<Int, Double>>()
            if (switchEqualSplit.isChecked) {
                val amountPerConsumer = amount / checkedViews.size
                checkedViews.forEach {
                    val id = it.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    consumerWeights.add(Pair(id, amountPerConsumer))
                }
            } else {
                checkedViews.forEach {
                    val id = it.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    val weight = it.findViewById<EditText>(R.id.et_amount).text.toString().toDoubleOrNull() ?: 0.0
                    consumerWeights.add(Pair(id, weight))
                }
                val totalAmountFromRows = consumerWeights.sumOf { it.second }
                if (Math.abs(totalAmountFromRows - amount) > 0.01) {
                    // FIX: Removed invalid ${'$'} escape and fixed String.format syntax
                    tvPercentageWarning.text = "The sum of individual amounts must equal the total amount. (Current sum: ${String.format(Locale.US, "%.2f", totalAmountFromRows)})"
                    UiSizing.setVisibilityMorph(tvPercentageWarning, View.VISIBLE, dialogRoot)
                    return@setOnClickListener
                }
            }

            val consumers = consumerWeights.map { it.first }
            if (itemToEdit != null) {
                viewModel.updateItem(itemToEdit.item.itemID, itemName, amount, payer.contributorID, consumers, consumerWeights, notes)
            } else {
                viewModel.insertItem(itemName, amount, payer.contributorID, sheetId, Date(), consumers, consumerWeights, notes)
            }
            dialog.dismiss()
        }
        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }
}

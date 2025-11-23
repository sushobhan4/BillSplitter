package com.raptor.billsplitter

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.switchmaterial.SwitchMaterial
import com.raptor.billsplitter.data.AppDatabase
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.ItemConsumer
import com.raptor.billsplitter.data.ItemWithPayerAndConsumers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToLong

class SheetViewActivity : AppCompatActivity() {

    private lateinit var expenseRecyclerView: RecyclerView
    private lateinit var expenseAdapter: ExpenseAdapter
    private lateinit var tvSheetName: TextView
    private var sheetId: Int = -1
    private lateinit var sharedPreferences: android.content.SharedPreferences
    private lateinit var viewModel: SheetViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
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

        tvSheetName = findViewById(R.id.tv_sheet_name)
        val btnCalculate: Button = findViewById(R.id.btn_calculate)
        val btnSort: ImageButton = findViewById(R.id.btn_sort_expenses)
        expenseRecyclerView = findViewById(R.id.rv_expenses)
        expenseRecyclerView.layoutManager = LinearLayoutManager(this)

        expenseAdapter = ExpenseAdapter(this) { action, item ->
            when (action) {
                "EDIT" -> lifecycleScope.launch {
                    val contributorsSnapshot = viewModel.contributors.first()
                    showAddExpenseDialog(contributorsSnapshot, item)
                }
                "DELETE" -> {
                    viewModel.deleteItem(item.item.itemID)
                    Toast.makeText(this, "Expense deleted", Toast.LENGTH_SHORT).show()
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
            }
        }

        lifecycleScope.launch {
            viewModel.items.collectLatest { items ->
                btnSort.visibility = if (items.size >= 2) View.VISIBLE else View.GONE
                applySortingAndSubmit(items)
                btnCalculate.visibility = if (items.isNotEmpty()) View.VISIBLE else View.GONE
            }
        }

        val btnAddItem: Button = findViewById(R.id.btn_add_item)
        btnAddItem.setOnClickListener {
            lifecycleScope.launch {
                val contributorsSnapshot = viewModel.contributors.first()
                showAddExpenseDialog(contributorsSnapshot, null)
            }
        }

        btnCalculate.setOnClickListener {
            lifecycleScope.launch {
                calculateBalances()
            }
        }

        btnSort.setOnClickListener {
            showSortDialog()
        }
    }

    private fun applySortingAndSubmit(items: List<ItemWithPayerAndConsumers>) {
        val sortBy = sharedPreferences.getInt("sortBy", R.id.rbDateModified)
        val sortOrder = sharedPreferences.getInt("sortOrder", R.id.rbDescending)
        val isAscending = sortOrder == R.id.rbAscending

        val sortedList = when (sortBy) {
            R.id.rbName -> {
                if (isAscending) items.sortedBy { it.item.itemName.lowercase(Locale.getDefault()) }
                else items.sortedByDescending { it.item.itemName.lowercase(Locale.getDefault()) }
            }
            R.id.rbAmount -> {
                if (isAscending) items.sortedBy { it.item.amount }
                else items.sortedByDescending { it.item.amount }
            }
            R.id.rbDateCreated -> {
                if (isAscending) items.sortedBy { it.item.dateCreated }
                else items.sortedByDescending { it.item.dateCreated }
            }
            R.id.rbDateModified -> {
                if (isAscending) items.sortedBy { it.item.dateModified }
                else items.sortedByDescending { it.item.dateModified }
            }
            else -> items
        }
        expenseAdapter.submitList(sortedList)
    }

    private fun showSortDialog() {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_sort_sheet)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

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
            // Re-apply sorting on the current list
            lifecycleScope.launch {
                viewModel.items.collectLatest { items ->
                    applySortingAndSubmit(items)
                }
            }
            dialog.dismiss()
        }

        dialog.show()
    }

    /**
     * calculateBalances: fully cents-safe, deterministic remainder distribution and detailed logs.
     * Convention: positive balance => should RECEIVE money; negative => owes money.
     */
    private suspend fun calculateBalances() {
        val TAG = "CalcBalances"
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        // balances as Double (use exact division like spreadsheet) — positive = should RECEIVE, negative = owes
        val balances = mutableMapOf<String, Double>()
        for (c in contributors) balances[c.contributorName] = 0.0

        for (item in items) {
            val payerName = item.payer.contributorName
            val amount = item.item.amount ?: 0.0
            if (amount <= 0.0) continue

            // get consumers from DB if present else UI consumers
            val itemConsumers: List<ItemConsumer> = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers ?: emptyList()

            val consumerNames: List<String> = if (itemConsumers.isNotEmpty()) {
                // when DB consumers present, use their ids mapped to names
                itemConsumers.mapNotNull { ic -> contributors.find { it.contributorID == ic.contributorID }?.contributorName }
            } else {
                uiConsumers.map { it.contributorName }
            }

            // if no consumers, credit payer full amount
            if (consumerNames.isEmpty()) {
                balances[payerName] = (balances[payerName] ?: 0.0) + amount
                Log.d(TAG, "Item='${item.item.itemName}': no consumers — credited $payerName $amount")
                continue
            }

            // Decide split: if itemConsumers have non-equal weights, use weighted division (proportional).
            val useWeighted = itemConsumers.isNotEmpty() && run {
                if (itemConsumers.size <= 1) false
                else {
                    val first = itemConsumers.first().weight
                    !itemConsumers.all { kotlin.math.abs(it.weight - first) < 0.01 }
                }
            }

            val perConsumer = mutableListOf<Pair<String, Double>>() // name -> share (positive number)

            if (useWeighted) {
                val sumWeights = itemConsumers.sumOf { it.weight }
                // compute proportional shares (double), no integer rounding
                itemConsumers.forEach { ic ->
                    val name = contributors.find { it.contributorID == ic.contributorID }?.contributorName ?: "unknown-${ic.contributorID}"
                    val share = (ic.weight / sumWeights) * amount
                    perConsumer.add(Pair(name, share))
                }
            } else {
                // equal split: divide amount by number of consumer names
                val n = consumerNames.size
                val share = amount / n
                consumerNames.forEach { name -> perConsumer.add(Pair(name, share)) }
            }

            // apply consumers' debits (they owe their share)
            perConsumer.forEach { (name, share) ->
                balances[name] = (balances[name] ?: 0.0) - share
            }

            // credit payer full amount
            balances[payerName] = (balances[payerName] ?: 0.0) + amount

            // log breakdown similar to your previous logs
            val sb = StringBuilder()
            sb.append("Item='${item.item.itemName}' amt=$amount payer=$payerName consumers=[")
            perConsumer.forEach { sb.append("${it.first}:${String.format(Locale.getDefault(), "%.6f", it.second)}, ") }
            sb.append("] -> running: ")
            contributors.forEach { c ->
                sb.append("${c.contributorName}=${String.format(Locale.getDefault(), "%.6f", balances[c.contributorName] ?: 0.0)}; ")
            }
            Log.d(TAG, sb.toString())
        }

        // final balances rounded to 6 decimals internally then display with 2 decimals
        val finalBalances = balances.mapValues { (_, v) ->
            // keep high precision in computation; display rounded to 2 decimals
            String.format(Locale.getDefault(), "%.2f", v).toDouble()
        }

        Log.d(TAG, "Final balances (pos=receive, neg=owe): $finalBalances")
        showBalancesDialog(finalBalances)
    }

    /**
     * One-time repair: synchronize DB itemConsumers with UI consumers when UI has more entries.
     * Run this once (e.g. call from a debug button or temporarily from onCreate) to fix mismatches.
     * It uses viewModel.updateItem(...) to rewrite the item's consumer list using equal weights.
     */
    private suspend fun repairConsumerMismatches() {
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        for (item in items) {
            val dbConsumers = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers ?: emptyList()

            // If UI lists more consumers than DB, assume UI is the source of truth and update DB
            if (uiConsumers.size > dbConsumers.size) {
                // prepare consumers ids and equal weights
                val consumerIds = uiConsumers.map { it.contributorID }
                val n = consumerIds.size
                val equalWeight = if (n > 0) 100.0 / n else 0.0
                val consumerWeights = consumerIds.map { Pair(it, equalWeight) }

                // call updateItem to overwrite consumers (run in a coroutine scope)
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
                    Log.d("CalcBalances", "Repaired item '${item.item.itemName}' — set consumers=${consumerIds}")
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

    private fun showBalancesDialog(balances: Map<String, Double>) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_balances)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val rvBalances = dialog.findViewById<RecyclerView>(R.id.rvBalances)
        rvBalances.layoutManager = LinearLayoutManager(this)
        rvBalances.adapter = BalanceAdapter(balances)

        dialog.show()
    }

    private fun showExpenseDetailsDialog(item: ItemWithPayerAndConsumers) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_details)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

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

        dialog.show()
    }

    /**
     * Updated showAddExpenseDialog with automatic percentage redistribution logic.
     * Also: spinner "Paid By" placeholder logic added (disabled placeholder at position 0).
     * Contributor lists and spinner names are sorted ascending (A -> Z).
     * EditText selection-on-tap behavior added: tapping a percentage box will select all text.
     */
    private suspend fun showAddExpenseDialog(contributorsSnapshot: List<Contributor>, itemToEdit: ItemWithPayerAndConsumers?) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_add_expense)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val etItemName = dialog.findViewById<EditText>(R.id.et_item_name)
        val etAmount = dialog.findViewById<EditText>(R.id.et_amount)
        val etNotes = dialog.findViewById<EditText>(R.id.et_notes)
        val spinnerPayer = dialog.findViewById<Spinner>(R.id.spinner_payer)
        val containerContributors = dialog.findViewById<LinearLayout>(R.id.ll_contributor_checkboxes)
        val btnDone = dialog.findViewById<Button>(R.id.btn_done)
        val btnCancel = dialog.findViewById<Button>(R.id.btn_cancel)
        val switchEqualSplit = dialog.findViewById<SwitchMaterial>(R.id.switch_equal_split)
        val tvPercentageWarning = dialog.findViewById<TextView>(R.id.tv_percentage_warning)

        // Sort contributors ascending by name (case-insensitive)
        val sortedContributors = contributorsSnapshot.sortedBy { it.contributorName.lowercase(Locale.getDefault()) }

        // Prepare spinner data with placeholder at index 0
        val placeholder = "Paid By"
        val names = sortedContributors.map { it.contributorName }
        val spinnerItems = mutableListOf<String>().apply {
            add(placeholder)
            addAll(names)
        }

        // Custom adapter to disable position 0 and style it gray
        val spinnerAdapter = object : ArrayAdapter<String>(this@SheetViewActivity, R.layout.spinner_item_josefin_sans, spinnerItems) {
            override fun isEnabled(position: Int): Boolean {
                // disable placeholder
                return position != 0
            }

            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getDropDownView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                val textView = tv ?: (view as TextView)
                if (position == 0) {
                    textView.setTextColor(Color.parseColor("#888888"))
                } else {
                    textView.setTextColor(Color.parseColor("#222222"))
                }
                return view
            }

            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                val textView = tv ?: (view as TextView)
                if (position == 0) {
                    textView.setTextColor(Color.parseColor("#888888"))
                } else {
                    textView.setTextColor(Color.parseColor("#222222"))
                }
                return view
            }
        }
        spinnerAdapter.setDropDownViewResource(R.layout.spinner_item_josefin_sans)
        spinnerPayer.adapter = spinnerAdapter
        spinnerPayer.setSelection(0) // default show placeholder

        val contributorViews = mutableListOf<View>()
        var isUpdatingProgrammatically = false

        containerContributors.removeAllViews()
        if (itemToEdit != null) {
            etItemName.setText(itemToEdit.item.itemName)
            etAmount.setText(itemToEdit.item.amount.toString())
            etNotes.setText(itemToEdit.item.notes)

            // get item consumers & payer
            val itemConsumers = viewModel.getItemConsumers(itemToEdit.item.itemID).first()
            val areWeightsEqual = if (itemConsumers.size <= 1) true else {
                val firstWeight = itemConsumers.first().weight
                itemConsumers.all { Math.abs(it.weight - firstWeight) < 0.01 }
            }
            switchEqualSplit.isChecked = areWeightsEqual

            // Populate contributor rows and their states (sorted)
            for (contrib in sortedContributors) {
                val rowView = LayoutInflater.from(this).inflate(R.layout.contributor_percentage_item, containerContributors, false)
                val cb = rowView.findViewById<CheckBox>(R.id.checkbox_contributor)
                cb.text = contrib.contributorName
                cb.tag = contrib.contributorID
                val consumer = itemConsumers.find { it.contributorID == contrib.contributorID }
                cb.isChecked = consumer != null

                if (consumer != null && !areWeightsEqual) {
                    val etPercentage = rowView.findViewById<EditText>(R.id.et_percentage)
                    etPercentage.setText(String.format(Locale.US, "%.2f", consumer.weight))
                }

                containerContributors.addView(rowView)
                contributorViews.add(rowView)
            }

            // Set spinner selection to the payer (accounting for placeholder offset)
            val payerIndex = sortedContributors.indexOfFirst { it.contributorID == itemToEdit.payer.contributorID }
            if (payerIndex >= 0) {
                spinnerPayer.setSelection(payerIndex + 1) // +1 because index 0 is placeholder
            } else {
                spinnerPayer.setSelection(0)
            }
        } else {
            // Populate contributor rows (sorted) for new item
            for (contrib in sortedContributors) {
                val rowView = LayoutInflater.from(this).inflate(R.layout.contributor_percentage_item, containerContributors, false)
                val cb = rowView.findViewById<CheckBox>(R.id.checkbox_contributor)
                cb.text = contrib.contributorName
                cb.tag = contrib.contributorID
                cb.isChecked = false
                containerContributors.addView(rowView)
                contributorViews.add(rowView)
            }
            // default spinner shows placeholder
            spinnerPayer.setSelection(0)
        }

        fun setProgrammaticUpdate(updating: Boolean) {
            isUpdatingProgrammatically = updating
        }

        fun redistributeAfterCheckboxChange() {
            setProgrammaticUpdate(true)
            val checkedViews = contributorViews.filter {
                it.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked
            }

            if (checkedViews.isNotEmpty()) {
                val percentage = 100.0 / checkedViews.size
                checkedViews.forEach {
                    it.findViewById<EditText>(R.id.et_percentage).setText(String.format(Locale.US, "%.2f", percentage))
                }
            }

            contributorViews.filterNot { checkedViews.contains(it) }.forEach {
                it.findViewById<EditText>(R.id.et_percentage).setText("")
            }
            setProgrammaticUpdate(false)
        }

        fun updatePercentageVisibility() {
            setProgrammaticUpdate(true)
            val isSplitEqually = switchEqualSplit.isChecked
            for (view in contributorViews) {
                val etPercentage = view.findViewById<EditText>(R.id.et_percentage)
                val cb = view.findViewById<CheckBox>(R.id.checkbox_contributor)
                if (isSplitEqually || !cb.isChecked) {
                    etPercentage.visibility = View.GONE
                    etPercentage.setText("")
                } else {
                    etPercentage.visibility = View.VISIBLE
                }
            }
            tvPercentageWarning.visibility = View.GONE
            setProgrammaticUpdate(false)
        }

        contributorViews.forEachIndexed { index, view ->
            val cb = view.findViewById<CheckBox>(R.id.checkbox_contributor)
            val etPercentage = view.findViewById<EditText>(R.id.et_percentage)

            // When user taps/clicks the percentage box, select all text.
            // We guard by isUpdatingProgrammatically so programmatic setText() won't trigger unwanted selection.
            etPercentage.setOnFocusChangeListener { v, hasFocus ->
                if (hasFocus && !isUpdatingProgrammatically) {
                    try {
                        etPercentage.selectAll()
                    } catch (e: Exception) {
                        // ignore selection errors silently
                    }
                }
            }

            // Some devices / IMEs may not trigger focus when tapped; ensure click also selects.
            etPercentage.setOnClickListener {
                if (!isUpdatingProgrammatically) {
                    try {
                        etPercentage.selectAll()
                    } catch (e: Exception) {
                        // ignore
                    }
                }
            }

            // Optional: handle touch to ensure selection after user lifts finger (more reliable on some devices)
            etPercentage.setOnTouchListener { v, event ->
                if (event.action == MotionEvent.ACTION_UP && !isUpdatingProgrammatically) {
                    try {
                        etPercentage.selectAll()
                    } catch (e: Exception) {
                        // ignore
                    }
                }
                // Return false so the EditText still handles the touch (shows keyboard / focuses)
                false
            }

            cb.setOnCheckedChangeListener { _, _ ->
                updatePercentageVisibility()
                if (!switchEqualSplit.isChecked) {
                    redistributeAfterCheckboxChange()
                }
            }

            etPercentage.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (isUpdatingProgrammatically) return

                    setProgrammaticUpdate(true)

                    val checkedViews = contributorViews.filter { v ->
                        v.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked && v.findViewById<EditText>(R.id.et_percentage).visibility == View.VISIBLE
                    }
                    val currentEt = etPercentage
                    val currentIndexInChecked = checkedViews.indexOfFirst { it.findViewById<EditText>(R.id.et_percentage) == currentEt }

                    if (currentIndexInChecked != -1) {
                        val currentValue = s.toString().toDoubleOrNull() ?: 0.0

                        val fixedViews = checkedViews.take(currentIndexInChecked)
                        val sumFixed = fixedViews.sumOf {
                            it.findViewById<EditText>(R.id.et_percentage).text.toString().toDoubleOrNull() ?: 0.0
                        }

                        val remainingViewsToAdjust = checkedViews.drop(currentIndexInChecked + 1)

                        if (remainingViewsToAdjust.isNotEmpty()) {
                            var remainingPercentage = 100.0 - sumFixed - currentValue
                            if (remainingPercentage < 0) remainingPercentage = 0.0
                            val percentagePerView = remainingPercentage / remainingViewsToAdjust.size

                            remainingViewsToAdjust.forEach { v ->
                                v.findViewById<EditText>(R.id.et_percentage).setText(String.format(Locale.US, "%.2f", percentagePerView))
                            }
                        } else if (currentIndexInChecked > 0) { // Last box, adjust previous
                            var remainingToDistribute = 100.0 - currentValue
                            if(remainingToDistribute < 0) remainingToDistribute = 0.0

                            val previousViews = fixedViews
                            val sumOfPrevious = previousViews.sumOf {
                                (it.findViewById<EditText>(R.id.et_percentage).text.toString().toDoubleOrNull() ?: 0.0)
                            }

                            if (sumOfPrevious > 0.01) {
                                val factor = remainingToDistribute / sumOfPrevious
                                previousViews.forEach { v ->
                                    val et = v.findViewById<EditText>(R.id.et_percentage)
                                    val oldValue = et.text.toString().toDoubleOrNull() ?: 0.0
                                    et.setText(String.format(Locale.US, "%.2f", oldValue * factor))
                                }
                            } else if (previousViews.isNotEmpty()){ // if previous sum is 0, distribute equally
                                val percentagePerView = remainingToDistribute / previousViews.size
                                previousViews.forEach { v ->
                                    v.findViewById<EditText>(R.id.et_percentage).setText(String.format(Locale.US, "%.2f", percentagePerView))
                                }
                            }
                        }
                    }
                    setProgrammaticUpdate(false)
                }
            })
        }

        switchEqualSplit.setOnCheckedChangeListener { _, isChecked ->
            updatePercentageVisibility()
            if (!isChecked) {
                redistributeAfterCheckboxChange()
            }
        }

        updatePercentageVisibility()
        if (!switchEqualSplit.isChecked && itemToEdit == null) {
            redistributeAfterCheckboxChange()
        }

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnDone.setOnClickListener {
            val itemName = etItemName.text.toString().trim()
            val amountStr = etAmount.text.toString().trim()
            val amount = amountStr.toDoubleOrNull()
            val notes = etNotes.text.toString().trim()

            if (itemName.isEmpty()) {
                etItemName.error = "Item name cannot be empty."
                return@setOnClickListener
            }
            if (amount == null || amount <= 0) {
                etAmount.error = "Invalid amount."
                return@setOnClickListener
            }

            // Validate spinner selection: placeholder (index 0) is NOT a valid payer
            val selectedPos = spinnerPayer.selectedItemPosition
            if (selectedPos <= 0) {
                Toast.makeText(this, "A valid payer must be selected.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val selectedPayerName = spinnerPayer.selectedItem as String
            val payer = contributorsSnapshot.find { it.contributorName == selectedPayerName }

            if (payer == null) {
                Toast.makeText(this, "A valid payer must be selected.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val isSplitEqually = switchEqualSplit.isChecked
            val consumerWeights = mutableListOf<Pair<Int, Double>>()

            val checkedViews = contributorViews.filter { view ->
                view.findViewById<CheckBox>(R.id.checkbox_contributor).isChecked
            }

            if (checkedViews.isEmpty()) {
                Toast.makeText(this, "At least one consumer must be selected.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (isSplitEqually) {
                val percentage = 100.0 / checkedViews.size
                for (view in checkedViews) {
                    val contributorId = view.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    consumerWeights.add(Pair(contributorId, percentage))
                }
            } else {
                for (view in checkedViews) {
                    val contributorId = view.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    val etPercentage = view.findViewById<EditText>(R.id.et_percentage)
                    val weight = etPercentage.text.toString().toDoubleOrNull() ?: 0.0
                    consumerWeights.add(Pair(contributorId, weight))
                }
                val totalPercentage = consumerWeights.sumOf { it.second }
                if (Math.abs(totalPercentage - 100.0) > 0.01) {
                    tvPercentageWarning.text = "Total must be 100%, but is ${String.format(Locale.US, "%.2f", totalPercentage)}%"
                    tvPercentageWarning.visibility = View.VISIBLE
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

        dialog.show()
    }
}

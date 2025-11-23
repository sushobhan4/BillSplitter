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
import kotlin.math.abs
import kotlin.math.roundToLong

class SheetViewActivity : AppCompatActivity() {

    private lateinit var expenseRecyclerView: RecyclerView
    private lateinit var expenseAdapter: ExpenseAdapter
    private lateinit var tvSheetName: TextView
    private lateinit var tvEmptyExpenses: TextView
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
        tvEmptyExpenses = findViewById(R.id.tv_empty_expenses)
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
                if (items.isEmpty()) {
                    expenseRecyclerView.visibility = View.GONE
                    tvEmptyExpenses.visibility = View.VISIBLE
                } else {
                    expenseRecyclerView.visibility = View.VISIBLE
                    tvEmptyExpenses.visibility = View.GONE
                }
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

    private suspend fun calculateBalances() {
        val TAG = "CalcBalances"
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        val balances = mutableMapOf<String, Double>()
        for (c in contributors) balances[c.contributorName] = 0.0

        for (item in items) {
            val payerName = item.payer.contributorName
            val amount = item.item.amount ?: 0.0
            if (amount <= 0.0) continue

            val itemConsumers: List<ItemConsumer> = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers ?: emptyList()

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
                    !itemConsumers.all { kotlin.math.abs(it.weight - first) < 0.01 }
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

        val finalBalances = balances.mapValues { (_, v) ->
            String.format(Locale.getDefault(), "%.2f", v).toDouble()
        }

        Log.d(TAG, "Final balances (pos=receive, neg=owe): $finalBalances")
        showBalancesDialog(finalBalances)
    }

    private suspend fun repairConsumerMismatches() {
        val items = viewModel.items.first()
        val contributors = viewModel.contributors.first()

        for (item in items) {
            val dbConsumers = viewModel.getItemConsumers(item.item.itemID).first()
            val uiConsumers = item.consumers ?: emptyList()

            if (uiConsumers.size > dbConsumers.size) {
                val consumerIds = uiConsumers.map { it.contributorID }
                val n = consumerIds.size
                val equalWeight = if (n > 0) 100.0 / n else 0.0
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

    private suspend fun showAddExpenseDialog(contributorsSnapshot: List<Contributor>, itemToEdit: ItemWithPayerAndConsumers?) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_add_expense)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val etItemName = dialog.findViewById<EditText>(R.id.et_item_name)
        val etAmount = dialog.findViewById<EditText>(R.id.et_amount) // Main Total Amount
        val etNotes = dialog.findViewById<EditText>(R.id.et_notes)
        val spinnerPayer = dialog.findViewById<Spinner>(R.id.spinner_payer)
        val containerContributors = dialog.findViewById<LinearLayout>(R.id.ll_contributor_checkboxes)
        val btnDone = dialog.findViewById<Button>(R.id.btn_done)
        val btnCancel = dialog.findViewById<Button>(R.id.btn_cancel)
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

        val spinnerAdapter = object : ArrayAdapter<String>(this@SheetViewActivity, android.R.layout.simple_spinner_item, spinnerItems) {
            override fun isEnabled(position: Int): Boolean = position != 0
            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getDropDownView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                tv?.setTextColor(if (position == 0) Color.parseColor("#888888") else Color.parseColor("#222222"))
                return view
            }
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent)
                val tv = view.findViewById<TextView>(android.R.id.text1) ?: (view as? TextView)
                tv?.setTextColor(if (position == 0) Color.parseColor("#888888") else Color.parseColor("#222222"))
                return view
            }
        }
        spinnerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
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
                    val etPercentage = rowView.findViewById<EditText>(R.id.et_percentage)
                    etPercentage.setText(String.format(Locale.US, "%.2f", consumer.weight))

                    val etRowAmount = rowView.findViewById<EditText>(R.id.et_amount)
                    val amt = (itemToEdit.item.amount ?: 0.0) * (consumer.weight / 100.0)
                    etRowAmount.setText(String.format(Locale.US, "%.2f", amt))

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

        fun updateUIState() {
            setProgrammaticUpdate(true)
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
                    updateUIState()
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

            cb.setOnCheckedChangeListener { _, isChecked ->
                updateUIState()
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
            updateUIState()
        }

        // Initial State
        updateUIState()
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
                val percentage = 100.0 / checkedViews.size
                checkedViews.forEach {
                    val id = it.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    consumerWeights.add(Pair(id, percentage))
                }
            } else {
                checkedViews.forEach {
                    val id = it.findViewById<CheckBox>(R.id.checkbox_contributor).tag as Int
                    val weight = it.findViewById<EditText>(R.id.et_percentage).text.toString().toDoubleOrNull() ?: 0.0
                    consumerWeights.add(Pair(id, weight))
                }
                val totalP = consumerWeights.sumOf { it.second }
                if (Math.abs(totalP - 100.0) > 0.1) { // slightly looser tolerance for manual entry
                    tvPercentageWarning.text = "Total percentage must be 100% (Current: ${String.format(Locale.US, "%.2f", totalP)}%)"
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
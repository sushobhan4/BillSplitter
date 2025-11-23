package com.raptor.billsplitter

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.core.graphics.drawable.toDrawable
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.raptor.billsplitter.data.AppDatabase
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.SheetWithContributorsAndItems
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : AppCompatActivity() {

    private lateinit var recyclerView: RecyclerView
    private lateinit var cardAdapter: CardAdapter
    private val sharedPreferences by lazy { getSharedPreferences("BillSplitterPrefs", MODE_PRIVATE) }

    private val viewModel: MainViewModel by viewModels {
        MainViewModelFactory(AppDatabase.getDatabase(this).billSplitterDao())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        recyclerView = findViewById(R.id.recyclerView)
        recyclerView.layoutManager = LinearLayoutManager(this)

        val btnSort: ImageButton = findViewById(R.id.btnSort)

        cardAdapter = CardAdapter(this) { action, item ->
            when (action) {
                "EDIT" -> showAddSheetDialog(item)
                "DELETE" -> deleteCard(item)
                "DETAILS" -> showDetailsDialog(item)
                "OPEN" -> {
                    val intent = Intent(this, SheetViewActivity::class.java)
                    intent.putExtra("SHEET_ID", item.sheet.sheetID)
                    startActivity(intent)
                }
            }
        }
        recyclerView.adapter = cardAdapter

        lifecycleScope.launch {
            viewModel.sheets.collectLatest { sheets ->
                btnSort.visibility = if (sheets.size >= 2) View.VISIBLE else View.GONE
                applySortingAndSubmit(sheets)
            }
        }

        val addBtn: FloatingActionButton = findViewById(R.id.addBtn)
        addBtn.setOnClickListener {
            showAddSheetDialog(null)
        }

        btnSort.setOnClickListener {
            showSortDialog()
        }
    }

    private fun applySortingAndSubmit(sheets: List<SheetWithContributorsAndItems>) {
        val sortBy = sharedPreferences.getInt("sortBy", R.id.rbDateModified)
        val sortOrder = sharedPreferences.getInt("sortOrder", R.id.rbDescending)
        val isAscending = sortOrder == R.id.rbAscending

        val sortedList = when (sortBy) {
            R.id.rbName -> {
                if (isAscending) sheets.sortedBy { it.sheet.sheetName.lowercase(Locale.getDefault()) }
                else sheets.sortedByDescending { it.sheet.sheetName.lowercase(Locale.getDefault()) }
            }
            R.id.rbContributors -> {
                if (isAscending) sheets.sortedBy { it.contributors.size }
                else sheets.sortedByDescending { it.contributors.size }
            }
            R.id.rbDateCreated -> {
                if (isAscending) sheets.sortedBy { it.sheet.dateCreated }
                else sheets.sortedByDescending { it.sheet.dateCreated }
            }
            R.id.rbDateModified -> {
                if (isAscending) sheets.sortedBy { it.sheet.dateModified }
                else sheets.sortedByDescending { it.sheet.dateModified }
            }
            else -> sheets
        }
        cardAdapter.submitList(sortedList)
    }

    private fun showSortDialog() {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_sort)
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
                viewModel.sheets.collectLatest { sheets ->
                    applySortingAndSubmit(sheets)
                }
            }
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun deleteCard(item: SheetWithContributorsAndItems) {
        viewModel.deleteSheet(item.sheet.sheetID)
        Toast.makeText(this, getString(R.string.deleted), Toast.LENGTH_SHORT).show()
    }

    private fun showDetailsDialog(item: SheetWithContributorsAndItems) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.dialog_details)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        val tvName = dialog.findViewById<TextView>(R.id.tvName)
        val tvCreationTime = dialog.findViewById<TextView>(R.id.tvDateCreated)
        val tvModificationTime = dialog.findViewById<TextView>(R.id.tvDateModified)
        val tvContributorNames = dialog.findViewById<TextView>(R.id.tvContributors)
        val tvNotes = dialog.findViewById<TextView>(R.id.tvNotes)

        tvName.text = item.sheet.sheetName
        val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault())
        tvCreationTime.text = getString(R.string.created, sdf.format(item.sheet.dateCreated))
        tvModificationTime.text = getString(R.string.modified, sdf.format(item.sheet.dateModified))
        tvContributorNames.text = item.contributors.joinToString(", ") { it.contributorName }
        tvNotes.text = item.sheet.notes

        dialog.show()
    }


    private fun showAddSheetDialog(itemToEdit: SheetWithContributorsAndItems?) {
        val dialog = Dialog(this)
        dialog.setContentView(R.layout.add_sheet)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        val btnClose = dialog.findViewById<View>(R.id.btnClose)
        val etSheetName = dialog.findViewById<EditText>(R.id.etSheetName)
        val etSheetNotes = dialog.findViewById<EditText>(R.id.etSheetNotes)
        val containerContributors = dialog.findViewById<LinearLayout>(R.id.containerContributors)
        val scrollView = dialog.findViewById<ScrollView>(R.id.scrollViewContributors)
        val btnAddContributor = dialog.findViewById<View>(R.id.btnAddContributor)
        val btnAction = dialog.findViewById<Button>(R.id.btnCreateSheet)

        data class ContributorRow(val id: Int, val view: View)
        val contributorRows = mutableListOf<ContributorRow>()
        val nextId = AtomicInteger(-1)

        fun refreshDeleteButtons() {
            val childCount = containerContributors.childCount
            for (i in 0 until childCount) {
                val row = containerContributors.getChildAt(i)
                val btnDelete = row.findViewById<ImageButton>(R.id.btnDeleteContributor)
                btnDelete.visibility = if (childCount > 2) View.VISIBLE else View.INVISIBLE
            }
        }

        fun addContributorRow(contributor: Contributor? = null, requestFocus: Boolean = false) {
            val inflater = LayoutInflater.from(this)
            val rowView = inflater.inflate(R.layout.item_contributor, containerContributors, false)
            val etName = rowView.findViewById<EditText>(R.id.etContributorName)
            val btnDelete = rowView.findViewById<ImageButton>(R.id.btnDeleteContributor)

            etName.setText(contributor?.contributorName ?: "")
            val rowId = contributor?.contributorID ?: nextId.getAndDecrement()
            val row = ContributorRow(rowId, rowView)
            contributorRows.add(row)

            btnDelete.setOnClickListener {
                containerContributors.removeView(rowView)
                contributorRows.remove(row)
                refreshDeleteButtons()
            }

            containerContributors.addView(rowView)
            refreshDeleteButtons()

            if (requestFocus) {
                // Scroll down and request focus
                scrollView.post {
                    scrollView.fullScroll(View.FOCUS_DOWN)
                    etName.requestFocus()
                    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                    imm?.showSoftInput(etName, InputMethodManager.SHOW_IMPLICIT)
                }
            }
        }

        if (itemToEdit != null) {
            etSheetName.setText(itemToEdit.sheet.sheetName)
            etSheetNotes.setText(itemToEdit.sheet.notes)
            btnAction.text = getString(R.string.save)

            if (itemToEdit.contributors.isNotEmpty()) {
                for (contributor in itemToEdit.contributors) {
                    addContributorRow(contributor, requestFocus = false)
                }
            } else {
                addContributorRow(requestFocus = false)
                addContributorRow(requestFocus = false)
            }
        } else {
            btnAction.text = getString(R.string.create_sheet)
            addContributorRow(requestFocus = false)
            addContributorRow(requestFocus = false)
        }

        btnAddContributor.setOnClickListener {
            addContributorRow(requestFocus = true)
        }

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        btnAction.setOnClickListener {
            val sheetName = etSheetName.text.toString().trim()
            val sheetNotes = etSheetNotes.text.toString().trim()
            if (sheetName.isEmpty()) {
                etSheetName.error = getString(R.string.enter_sheet_name)
                return@setOnClickListener
            }

            val contributors = mutableMapOf<Int, String>()
            var allValid = true

            for (row in contributorRows) {
                val etName = row.view.findViewById<EditText>(R.id.etContributorName)
                val name = etName.text.toString().trim()

                if (name.isNotEmpty()) {
                    contributors[row.id] = name
                } else {
                    etName.error = getString(R.string.required)
                    allValid = false
                }
            }

            val distinctNames = contributors.values.map { it.lowercase(Locale.getDefault()) }.toSet()
            if (distinctNames.size < contributors.size) {
                Toast.makeText(this, "Contributor names must be unique.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (allValid && contributors.size >= 2) {
                if (itemToEdit != null) {
                    viewModel.updateSheet(itemToEdit.sheet.sheetID, sheetName, sheetNotes, contributors)
                } else {
                    viewModel.addSheet(sheetName, sheetNotes, contributors.values.toList())
                }
                dialog.dismiss()
            } else if (contributors.size < 2) {
                Toast.makeText(this, getString(R.string.need_at_least_2_valid_contributors), Toast.LENGTH_SHORT).show()
            }
        }

        dialog.show()
    }
}

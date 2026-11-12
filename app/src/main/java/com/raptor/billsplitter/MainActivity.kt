package com.raptor.billsplitter

import android.app.Dialog
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.FileProvider
import androidx.core.content.edit
import androidx.core.graphics.drawable.toDrawable
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.raptor.billsplitter.data.AppDatabase
import com.raptor.billsplitter.data.Contributor
import com.raptor.billsplitter.data.SheetBinaryCodec
import com.raptor.billsplitter.data.SheetWithContributorsAndItems
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

class MainActivity : AppCompatActivity() {

    private lateinit var recyclerView: RecyclerView
    private lateinit var tvEmptySheets: TextView
    private lateinit var cardAdapter: CardAdapter
    private val sharedPreferences by lazy { getSharedPreferences("BillSplitterPrefs", MODE_PRIVATE) }
    private var allSheets: List<SheetWithContributorsAndItems> = emptyList()
    private var currentSearchQuery: String = ""
    private var pendingExportSheetId: Int? = null
    private var pendingExportReadOnly: Boolean = false

    private val viewModel: MainViewModel by viewModels {
        MainViewModelFactory(AppDatabase.getDatabase(this))
    }

    private val importSheetLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) importSheet(uri)
    }

    private val saveExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val sheetId = pendingExportSheetId
        val readOnly = pendingExportReadOnly
        pendingExportSheetId = null
        if (uri != null && sheetId != null) {
            saveExportedSheetToUri(sheetId, readOnly, uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        recyclerView = findViewById(R.id.recyclerView)
        tvEmptySheets = findViewById(R.id.tvEmptySheets)
        recyclerView.layoutManager = LinearLayoutManager(this)

        val rootMain = findViewById<ViewGroup>(R.id.main)
        val btnSort: ImageButton = findViewById(R.id.btnSort)
        val etSearchSheets: EditText = findViewById(R.id.etSearchSheets)
        val btnClearSheetSearch: ImageButton = findViewById(R.id.btnClearSheetSearch)

        etSearchSheets.doAfterTextChanged { text ->
            currentSearchQuery = text?.toString().orEmpty()
            UiSizing.setVisibilityMorph(
                btnClearSheetSearch,
                if (currentSearchQuery.isNotEmpty()) View.VISIBLE else View.GONE
            )
            applySortingAndSubmit(allSheets)
        }

        btnClearSheetSearch.setOnClickListener {
            etSearchSheets.setText("")
        }

        cardAdapter = CardAdapter(this) { action, item ->
            when (action) {
                "EDIT" -> showAddSheetDialog(item)
                "DELETE" -> deleteCard(item)
                "DETAILS" -> showDetailsDialog(item)
                "SHARE" -> showExportOptionsDialog(item)
                "CLONE" -> showCloneOptionsDialog(item)
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
                allSheets = sheets
                UiSizing.setVisibilityMorph(
                    btnSort,
                    if (sheets.size >= 2) View.VISIBLE else View.GONE,
                    rootMain
                )
                applySortingAndSubmit(sheets)
            }
        }

        val addBtn: FloatingActionButton = findViewById(R.id.addBtn)
        addBtn.setOnClickListener {
            showAddSheetOptions(it)
        }

        btnSort.setOnClickListener {
            showSortDialog()
        }

        if (savedInstanceState == null) {
            handleIncomingIntent(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) {
            val uri = intent.data ?: return
            intent.data = null
            importSheet(uri)
        }
    }

    private fun showAddSheetOptions(anchorView: View) {
        val popupView = LayoutInflater.from(this).inflate(R.layout.popup_add_sheet, null)
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

        popupView.findViewById<View>(R.id.menuNewSheet).setOnClickListener {
            popupWindow.dismiss()
            showAddSheetDialog(null)
        }
        popupView.findViewById<View>(R.id.menuImportSheet).setOnClickListener {
            popupWindow.dismiss()
            importSheetLauncher.launch(arrayOf("application/octet-stream", "*/*"))
        }

        UiSizing.showAnchoredPopup(anchorView, popupWindow, popupWidth, preferAbove = true)
    }

    private fun showExportOptionsDialog(item: SheetWithContributorsAndItems) {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_export_sheet, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        dialog.findViewById<TextView>(R.id.tvExportSubtitle).text = item.sheet.sheetName
        val cbReadOnly = dialog.findViewById<CheckBox>(R.id.cbExportReadOnly)
        val tvReadOnlyHint = dialog.findViewById<TextView>(R.id.tvExportReadOnlyHint)
        val rowReadOnly = dialog.findViewById<View>(R.id.rowExportReadOnly)

        if (item.sheet.isReadOnly) {
            cbReadOnly.isChecked = true
            cbReadOnly.isEnabled = false
            tvReadOnlyHint.text = "This sheet is strictly read-only and can only be exported as read-only"
        } else {
            cbReadOnly.isChecked = false
            cbReadOnly.isEnabled = true
            rowReadOnly.setOnClickListener { cbReadOnly.toggle() }
        }

        dialog.findViewById<View>(R.id.btnCloseExportDialog).setOnClickListener {
            dialog.dismiss()
        }
        dialog.findViewById<View>(R.id.btnExportShare).setOnClickListener {
            val readOnly = item.sheet.isReadOnly || cbReadOnly.isChecked
            dialog.dismiss()
            shareSheet(item, readOnly)
        }
        dialog.findViewById<View>(R.id.btnExportSave).setOnClickListener {
            val readOnly = item.sheet.isReadOnly || cbReadOnly.isChecked
            pendingExportSheetId = item.sheet.sheetID
            pendingExportReadOnly = readOnly
            dialog.dismiss()
            val fileName = "${item.sheet.sheetName.toExportFileName()}.bsplit"
            saveExportLauncher.launch(fileName)
        }

        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }

    private fun shareSheet(item: SheetWithContributorsAndItems, makeReadOnly: Boolean = false) {
        lifecycleScope.launch {
            try {
                val baseExportData = viewModel.getExportData(item.sheet.sheetID)
                    ?: throw IOException("Sheet no longer exists.")
                val exportData = baseExportData.copy(
                    sheet = baseExportData.sheet.copy(
                        isReadOnly = baseExportData.sheet.isReadOnly || makeReadOnly
                    )
                )
                val fileName = "${item.sheet.sheetName.toExportFileName()}.bsplit"
                val contentUri = withContext(Dispatchers.IO) {
                    val shareDir = File(cacheDir, "shared_sheets").apply { mkdirs() }
                    val cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L
                    shareDir.listFiles()?.forEach { oldFile ->
                        if (oldFile.lastModified() < cutoff) {
                            oldFile.delete()
                        }
                    }
                    val encodedBytes = SheetBinaryCodec.encode(exportData)
                    val outFile = File(shareDir, fileName)
                    outFile.writeBytes(encodedBytes)
                    FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        outFile
                    )
                }

                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/octet-stream"
                    putExtra(Intent.EXTRA_STREAM, contentUri)
                    putExtra(Intent.EXTRA_SUBJECT, fileName)
                    clipData = ClipData.newRawUri(fileName, contentUri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(shareIntent, "Share sheet"))
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Share failed: ${e.message ?: "Unable to prepare sheet"}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun saveExportedSheetToUri(sheetId: Int, makeReadOnly: Boolean, targetUri: Uri) {
        lifecycleScope.launch {
            try {
                val baseExportData = viewModel.getExportData(sheetId)
                    ?: throw IOException("Sheet no longer exists.")
                val exportData = baseExportData.copy(
                    sheet = baseExportData.sheet.copy(
                        isReadOnly = baseExportData.sheet.isReadOnly || makeReadOnly
                    )
                )
                withContext(Dispatchers.IO) {
                    val encodedBytes = SheetBinaryCodec.encode(exportData)
                    contentResolver.openOutputStream(targetUri)?.use { out ->
                        out.write(encodedBytes)
                        out.flush()
                    } ?: throw IOException("Could not write to selected location.")
                }
                val suffix = if (exportData.sheet.isReadOnly) " (read-only)" else ""
                Toast.makeText(
                    this@MainActivity,
                    "Saved .bsplit to device$suffix",
                    Toast.LENGTH_SHORT
                ).show()
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Save failed: ${e.message ?: "Unable to save sheet"}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun importSheet(uri: Uri) {
        lifecycleScope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IOException("Could not open the selected file.")
                }
                val importedSheetId = viewModel.importSheet(SheetBinaryCodec.decode(bytes))
                Toast.makeText(this@MainActivity, "Sheet imported", Toast.LENGTH_SHORT).show()
                startActivity(
                    Intent(this@MainActivity, SheetViewActivity::class.java)
                        .putExtra("SHEET_ID", importedSheetId)
                )
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Import failed: ${e.message ?: "Invalid or modified .bsplit file"}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun String.toExportFileName(): String {
        val safeName = replace(Regex("[^A-Za-z0-9._-]+"), "_").trim('_', '.')
        return safeName.ifBlank { "sheet" }
    }

    private fun applySortingAndSubmit(sheets: List<SheetWithContributorsAndItems>) {
        val query = currentSearchQuery.trim()
        val filteredSheets = if (query.isEmpty()) {
            sheets
        } else {
            sheets.filter { item ->
                item.sheet.sheetName.contains(query, ignoreCase = true) ||
                    (item.sheet.notes?.contains(query, ignoreCase = true) == true) ||
                    item.contributors.any { it.contributorName.contains(query, ignoreCase = true) }
            }
        }

        val sortBy = sharedPreferences.getInt("sortBy", R.id.rbDateModified)
        val sortOrder = sharedPreferences.getInt("sortOrder", R.id.rbDescending)
        val isAscending = sortOrder == R.id.rbAscending

        val sortedList = when (sortBy) {
            R.id.rbName -> {
                if (isAscending) filteredSheets.sortedBy { it.sheet.sheetName.lowercase(Locale.getDefault()) }
                else filteredSheets.sortedByDescending { it.sheet.sheetName.lowercase(Locale.getDefault()) }
            }
            R.id.rbContributors -> {
                if (isAscending) filteredSheets.sortedBy { it.contributors.size }
                else filteredSheets.sortedByDescending { it.contributors.size }
            }
            R.id.rbDateCreated -> {
                if (isAscending) filteredSheets.sortedBy { it.sheet.dateCreated }
                else filteredSheets.sortedByDescending { it.sheet.dateCreated }
            }
            R.id.rbDateModified -> {
                if (isAscending) filteredSheets.sortedBy { it.sheet.dateModified }
                else filteredSheets.sortedByDescending { it.sheet.dateModified }
            }
            else -> filteredSheets
        }
        val showSearchEmpty = query.isNotEmpty() && sortedList.isEmpty()
        val targetEmptyVisibility = if (showSearchEmpty) View.VISIBLE else View.GONE
        val targetListVisibility = if (showSearchEmpty) View.GONE else View.VISIBLE
        if (tvEmptySheets.visibility != targetEmptyVisibility || recyclerView.visibility != targetListVisibility) {
            UiSizing.animateMorph(findViewById(R.id.main))
            tvEmptySheets.visibility = targetEmptyVisibility
            recyclerView.visibility = targetListVisibility
        }
        cardAdapter.submitList(sortedList)
    }

    private fun showSortDialog() {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_sort, null)
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
            applySortingAndSubmit(allSheets)
            dialog.dismiss()
        }

        UiSizing.setDialogWidthFraction(dialog, dialogView, 0.60f)
        dialog.show()
        UiSizing.setDialogWidthFraction(dialog, dialogView, 0.60f)
    }

    private fun deleteCard(item: SheetWithContributorsAndItems) {
        val message = if (item.items.isNotEmpty()) {
            "Are you sure you want to delete \"${item.sheet.sheetName}\"? All ${item.items.size} item(s) and balances in this sheet will be permanently deleted."
        } else {
            "Are you sure you want to delete \"${item.sheet.sheetName}\"? This action cannot be undone."
        }
        UiSizing.showConfirmDialog(
            context = this,
            title = "Delete sheet?",
            message = message,
            confirmText = "Delete"
        ) {
            viewModel.deleteSheet(item.sheet.sheetID)
            Toast.makeText(this, getString(R.string.deleted), Toast.LENGTH_SHORT).show()
        }
    }

    private fun showDetailsDialog(item: SheetWithContributorsAndItems) {
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_details, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

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
        tvNotes.text = if (item.sheet.isReadOnly) {
            listOfNotNull(item.sheet.notes?.takeIf { it.isNotBlank() }, "Access: Read-only").joinToString("\n\n")
        } else {
            item.sheet.notes
        }

        UiSizing.fitDialogToContent(dialog, dialogView)
        dialog.show()
        UiSizing.fitDialogToContent(dialog, dialogView)
    }


    private fun showCloneOptionsDialog(sourceItem: SheetWithContributorsAndItems) {
        if (sourceItem.sheet.isReadOnly) {
            Toast.makeText(this, "Read-only sheets cannot be cloned.", Toast.LENGTH_SHORT).show()
            return
        }
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_clone_options, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        dialog.findViewById<TextView>(R.id.tvCloneSubtitle).text = sourceItem.sheet.sheetName
        dialog.findViewById<View>(R.id.btnCloseCloneDialog).setOnClickListener {
            dialog.dismiss()
        }
        dialog.findViewById<View>(R.id.btnOptionCloneEmpty).setOnClickListener {
            dialog.dismiss()
            showAddSheetDialog(itemToEdit = null, cloneSource = sourceItem, carryoverBalancesById = null)
        }
        dialog.findViewById<View>(R.id.btnOptionCloneWithBalance).setOnClickListener {
            dialog.dismiss()
            lifecycleScope.launch {
                val nonZeroBalances = viewModel.getNonZeroCarryoverBalances(sourceItem.sheet.sheetID)
                showAddSheetDialog(
                    itemToEdit = null,
                    cloneSource = sourceItem,
                    carryoverBalancesById = nonZeroBalances
                )
            }
        }

        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }

    private fun showDropBalanceWarningDialog(
        memberName: String,
        balance: Double,
        onConfirmRemove: () -> Unit
    ) {
        val formattedAmount = String.format(Locale.getDefault(), "\u20B9%,.2f", abs(balance))
        val displayName = memberName.ifBlank { "This member" }
        val message = if (balance > 0) {
            "$displayName will receive $formattedAmount from the previous sheet. Deleting them will drop their carried-over balance."
        } else {
            "$displayName owes $formattedAmount from the previous sheet. Deleting them will drop their carried-over balance."
        }

        UiSizing.showConfirmDialog(
            context = this,
            title = "Drop carried balance?",
            message = message,
            confirmText = "Remove",
            onConfirm = onConfirmRemove
        )
    }

    private fun showAddSheetDialog(
        itemToEdit: SheetWithContributorsAndItems?,
        cloneSource: SheetWithContributorsAndItems? = null,
        carryoverBalancesById: Map<Int, Double>? = null
    ) {
        if (itemToEdit?.sheet?.isReadOnly == true || cloneSource?.sheet?.isReadOnly == true) {
            Toast.makeText(this, "Read-only sheets cannot be edited or cloned.", Toast.LENGTH_SHORT).show()
            return
        }
        val dialog = Dialog(this)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.add_sheet, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        UiSizing.applyDialogMorph(dialog)

        val dialogRoot = dialogView as? ViewGroup
        val tvTitle = dialog.findViewById<TextView>(R.id.tvTitle)
        val btnClose = dialog.findViewById<View>(R.id.btnClose)
        val etSheetName = dialog.findViewById<EditText>(R.id.etSheetName)
        val etSheetNotes = dialog.findViewById<EditText>(R.id.etSheetNotes)
        val containerContributors = dialog.findViewById<LinearLayout>(R.id.containerContributors)
        val scrollView = dialog.findViewById<ScrollView>(R.id.scrollViewContributors)
        val btnAddContributor = dialog.findViewById<View>(R.id.btnAddContributor)
        val btnAction = dialog.findViewById<Button>(R.id.btnCreateSheet)

        data class ContributorRow(val id: Int, val view: View, val carryoverBalance: Double = 0.0)
        val contributorRows = mutableListOf<ContributorRow>()
        val nextId = AtomicInteger(-1)

        fun refreshDeleteButtons() {
            val childCount = containerContributors.childCount
            val deleteVisibility = if (childCount > 2) View.VISIBLE else View.GONE
            for (i in 0 until childCount) {
                val row = containerContributors.getChildAt(i)
                val btnDelete = row.findViewById<ImageButton>(R.id.btnDeleteContributor)
                btnDelete.visibility = deleteVisibility
            }
        }

        fun addContributorRow(
            contributor: Contributor? = null,
            requestFocus: Boolean = false,
            animate: Boolean = false,
            useFreshId: Boolean = false,
            carryoverBalance: Double = 0.0
        ) {
            if (animate) {
                UiSizing.animateMorph(dialogRoot)
            }
            val inflater = LayoutInflater.from(this)
            val rowView = inflater.inflate(R.layout.item_contributor, containerContributors, false)
            val etName = rowView.findViewById<EditText>(R.id.etContributorName)
            val btnDelete = rowView.findViewById<ImageButton>(R.id.btnDeleteContributor)

            etName.setText(contributor?.contributorName ?: "")
            val rowId = if (useFreshId || contributor == null) {
                nextId.getAndDecrement()
            } else {
                contributor.contributorID
            }
            val row = ContributorRow(rowId, rowView, carryoverBalance)
            contributorRows.add(row)

            val performRemoveRow = {
                UiSizing.animateMorph(dialogRoot)
                containerContributors.removeView(rowView)
                contributorRows.remove(row)
                refreshDeleteButtons()
            }

            btnDelete.setOnClickListener {
                val currentName = etName.text.toString().trim()
                when {
                    abs(row.carryoverBalance) >= 0.005 -> {
                        showDropBalanceWarningDialog(
                            memberName = currentName,
                            balance = row.carryoverBalance,
                            onConfirmRemove = performRemoveRow
                        )
                    }
                    row.id > 0 || currentName.isNotEmpty() -> {
                        val displayName = currentName.ifBlank { "this member" }
                        UiSizing.showConfirmDialog(
                            context = this@MainActivity,
                            title = "Remove member?",
                            message = "Are you sure you want to remove \"$displayName\" from this sheet?",
                            confirmText = "Remove",
                            onConfirm = performRemoveRow
                        )
                    }
                    else -> {
                        performRemoveRow()
                    }
                }
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
            tvTitle.text = "Edit Sheet"
            etSheetName.setText(itemToEdit.sheet.sheetName)
            etSheetNotes.setText(itemToEdit.sheet.notes)
            btnAction.text = getString(R.string.save)

            if (itemToEdit.contributors.isNotEmpty()) {
                for (contributor in itemToEdit.contributors) {
                    addContributorRow(contributor, requestFocus = false, animate = false)
                }
            } else {
                addContributorRow(requestFocus = false, animate = false)
                addContributorRow(requestFocus = false, animate = false)
            }
        } else if (cloneSource != null) {
            tvTitle.text = "Create Sheet"
            etSheetName.setText(cloneSource.sheet.sheetName)
            etSheetNotes.setText(cloneSource.sheet.notes ?: "")
            btnAction.text = getString(R.string.create_sheet)

            if (carryoverBalancesById != null) {
                val unsettledContributors = cloneSource.contributors.filter { contributor ->
                    abs(carryoverBalancesById[contributor.contributorID] ?: 0.0) >= 0.005
                }
                if (unsettledContributors.isEmpty()) {
                    Toast.makeText(
                        this,
                        "All members in \"${cloneSource.sheet.sheetName}\" are already settled up.",
                        Toast.LENGTH_SHORT
                    ).show()
                    addContributorRow(requestFocus = false, animate = false)
                    addContributorRow(requestFocus = false, animate = false)
                } else {
                    unsettledContributors.forEach { contributor ->
                        val balance = carryoverBalancesById[contributor.contributorID] ?: 0.0
                        addContributorRow(
                            contributor = contributor,
                            requestFocus = false,
                            animate = false,
                            useFreshId = true,
                            carryoverBalance = balance
                        )
                    }
                    while (contributorRows.size < 2) {
                        addContributorRow(requestFocus = false, animate = false)
                    }
                }
            } else {
                cloneSource.contributors.forEach { contributor ->
                    addContributorRow(
                        contributor = contributor,
                        requestFocus = false,
                        animate = false,
                        useFreshId = true
                    )
                }
                while (contributorRows.size < 2) {
                    addContributorRow(requestFocus = false, animate = false)
                }
            }
        } else {
            tvTitle.text = "Create Sheet"
            btnAction.text = getString(R.string.create_sheet)
            addContributorRow(requestFocus = false, animate = false)
            addContributorRow(requestFocus = false, animate = false)
        }

        btnAddContributor.setOnClickListener {
            addContributorRow(requestFocus = true, animate = true)
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
            val contributorsWithBalances = mutableListOf<Pair<String, Double>>()
            var allValid = true

            for (row in contributorRows) {
                val etName = row.view.findViewById<EditText>(R.id.etContributorName)
                val name = etName.text.toString().trim()

                if (name.isNotEmpty()) {
                    contributors[row.id] = name
                    contributorsWithBalances.add(name to row.carryoverBalance)
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
                } else if (cloneSource != null && carryoverBalancesById != null &&
                    contributorsWithBalances.any { abs(it.second) >= 0.005 }
                ) {
                    lifecycleScope.launch {
                        viewModel.addClonedSheetWithBalances(
                            sheetName = sheetName,
                            notes = sheetNotes,
                            contributorsWithBalance = contributorsWithBalances,
                            sourceSheetName = cloneSource.sheet.sheetName
                        )
                    }
                } else {
                    viewModel.addSheet(sheetName, sheetNotes, contributors.values.toList())
                }
                dialog.dismiss()
            } else if (contributors.size < 2) {
                Toast.makeText(this, getString(R.string.need_at_least_2_valid_contributors), Toast.LENGTH_SHORT).show()
            }
        }

        UiSizing.setDialogFullWidth(dialog, dialogView)
        dialog.show()
        UiSizing.setDialogFullWidth(dialog, dialogView)
    }
}

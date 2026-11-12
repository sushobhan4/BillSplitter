package com.raptor.billsplitter

import android.content.Context
import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.PopupWindow
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toDrawable
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raptor.billsplitter.data.Item
import com.raptor.billsplitter.data.SheetWithContributorsAndItems
import java.util.Locale

class CardAdapter(
    private val context: Context,
    private val onMenuAction: (String, SheetWithContributorsAndItems) -> Unit
) : ListAdapter<SheetWithContributorsAndItems, CardAdapter.CardViewHolder>(SheetDiffCallback()) {

    class CardViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvHeading: TextView = itemView.findViewById(R.id.expenseName)
        val tvNames: TextView = itemView.findViewById(R.id.contributorList)
        val btnMenu: ImageView = itemView.findViewById(R.id.btnMenu)
        val cardView: View = itemView.findViewById(R.id.cardView)
        val tvSheetAmount: TextView = itemView.findViewById(R.id.sheetAmount)
        val tvStatus: TextView = itemView.findViewById(R.id.sheetStatus)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.sheet_card, parent, false)
        return CardViewHolder(view)
    }

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val currentItem = getItem(position)

        holder.tvHeading.text = currentItem.sheet.sheetName
        val sortedNames = currentItem.contributors.map { it.contributorName }.sorted().joinToString(separator = ", ")
        holder.tvNames.text = sortedNames.ifBlank { "No contributors yet" }
        if (currentItem.sheet.isReadOnly) {
            holder.tvStatus.text = "READ ONLY"
            holder.tvStatus.setTextColor(ContextCompat.getColor(context, R.color.carryover_accent))
        } else {
            holder.tvStatus.text = if (currentItem.items.isEmpty()) "READY TO SPLIT" else "ACTIVE SHEET"
            holder.tvStatus.setTextColor(ContextCompat.getColor(context, R.color.receive_text))
        }

        val totalAmount = currentItem.items
            .filter { it.itemType == Item.TYPE_EXPENSE }
            .sumOf { it.amount }
        holder.tvSheetAmount.text = String.format(Locale.getDefault(), "\u20B9%,.2f", totalAmount)

        holder.btnMenu.setOnClickListener { view ->
            showCustomPopup(view, currentItem)
        }

        holder.cardView.setOnClickListener {
            onMenuAction("OPEN", currentItem)
        }
    }

    private fun showCustomPopup(anchorView: View, item: SheetWithContributorsAndItems) {
        val inflater = LayoutInflater.from(context)
        val popupView = inflater.inflate(R.layout.popup_layout, null)

        val popupWidth = UiSizing.measurePopupWidth(popupView)
        val popupWindow = PopupWindow(
            popupView,
            popupWidth,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        )
        popupWindow.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        popupWindow.elevation = 6f
        UiSizing.applyPopupMorph(popupWindow)

        val btnEdit = popupView.findViewById<TextView>(R.id.menuEdit)
        val dividerEdit = popupView.findViewById<View>(R.id.dividerEdit)
        val btnDelete = popupView.findViewById<TextView>(R.id.menuDelete)
        val btnDetails = popupView.findViewById<TextView>(R.id.menuDetails)
        val btnShare = popupView.findViewById<TextView>(R.id.menuShare)
        val btnClone = popupView.findViewById<TextView>(R.id.menuClone)
        val dividerClone = popupView.findViewById<View>(R.id.dividerClone)

        if (item.sheet.isReadOnly) {
            btnEdit.visibility = View.GONE
            dividerEdit?.visibility = View.GONE
            btnClone.visibility = View.GONE
            dividerClone?.visibility = View.GONE
        }

        btnEdit.setOnClickListener {
            onMenuAction("EDIT", item)
            popupWindow.dismiss()
        }

        btnDelete.setOnClickListener {
            onMenuAction("DELETE", item)
            popupWindow.dismiss()
        }

        btnShare.setOnClickListener {
            onMenuAction("SHARE", item)
            popupWindow.dismiss()
        }

        btnClone.setOnClickListener {
            onMenuAction("CLONE", item)
            popupWindow.dismiss()
        }

        btnDetails.setOnClickListener {
            onMenuAction("DETAILS", item)
            popupWindow.dismiss()
        }

        UiSizing.showAnchoredPopup(anchorView, popupWindow, popupWidth)
    }
}

class SheetDiffCallback : DiffUtil.ItemCallback<SheetWithContributorsAndItems>() {
    override fun areItemsTheSame(oldItem: SheetWithContributorsAndItems, newItem: SheetWithContributorsAndItems): Boolean {
        return oldItem.sheet.sheetID == newItem.sheet.sheetID
    }

    override fun areContentsTheSame(oldItem: SheetWithContributorsAndItems, newItem: SheetWithContributorsAndItems): Boolean {
        return oldItem == newItem
    }
}

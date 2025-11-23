package com.raptor.billsplitter

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.PopupWindow
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raptor.billsplitter.data.SheetWithContributorsAndItems

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
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.sheet_card, parent, false)
        return CardViewHolder(view)
    }

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val currentItem = getItem(position)

        holder.tvHeading.text = currentItem.sheet.sheetName
        val sortedNames = currentItem.contributors.map { it.contributorName }.sorted().joinToString(separator = "   ")
        holder.tvNames.text = sortedNames

        val totalAmount = currentItem.items.sumOf { it.amount }
        holder.tvSheetAmount.text = String.format("%.1f", totalAmount)

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

        val popupWindow = PopupWindow(
            popupView,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        )
        popupWindow.elevation = 10f

        val btnEdit = popupView.findViewById<TextView>(R.id.menuEdit)
        val btnDelete = popupView.findViewById<TextView>(R.id.menuDelete)
        val btnDetails = popupView.findViewById<TextView>(R.id.menuDetails)

        btnEdit.setOnClickListener {
            onMenuAction("EDIT", item)
            popupWindow.dismiss()
        }

        btnDelete.setOnClickListener {
            onMenuAction("DELETE", item)
            popupWindow.dismiss()
        }

        btnDetails.setOnClickListener {
            onMenuAction("DETAILS", item)
            popupWindow.dismiss()
        }

        popupWindow.showAsDropDown(anchorView, 0, 0)
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

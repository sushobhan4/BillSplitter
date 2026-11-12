package com.raptor.billsplitter

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView
import com.raptor.billsplitter.data.Item
import com.raptor.billsplitter.data.ItemWithPayerAndConsumers
import java.text.SimpleDateFormat
import java.util.Locale

class ExpenseAdapter(
    private val context: Context,
    private val onMenuAction: (String, ItemWithPayerAndConsumers) -> Unit
) : ListAdapter<ItemWithPayerAndConsumers, ExpenseAdapter.ExpenseViewHolder>(ExpenseDiffCallback()) {

    private var isReadOnly: Boolean = false

    fun setReadOnly(readOnly: Boolean) {
        isReadOnly = readOnly
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ExpenseViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.expense_card, parent, false)
        return ExpenseViewHolder(view)
    }

    override fun onBindViewHolder(holder: ExpenseViewHolder, position: Int) {
        val item = getItem(position)
        holder.expenseName.text = item.item.itemName
        holder.expenseAmount.text = String.format(Locale.getDefault(), "\u20B9%,.2f", item.item.amount)
        holder.expenseDate.text = SimpleDateFormat("MMMM d, yyyy", Locale.getDefault()).format(item.item.dateCreated)
        holder.payerName.text = item.payer.contributorName

        val itemType = item.item.itemType
        when (itemType) {
            Item.TYPE_SETTLEMENT -> {
                holder.cardView.setCardBackgroundColor(ContextCompat.getColor(context, R.color.settlement_card_bg))
                holder.cardView.strokeColor = ContextCompat.getColor(context, R.color.settlement_card_stroke)
                holder.expenseMetaPanel.setBackgroundResource(R.drawable.bg_settlement_panel)
                holder.expenseIcon.setBackgroundResource(R.drawable.bg_settlement_icon)
                holder.expenseIcon.text = "✓"
                holder.expenseIcon.setTextColor(ContextCompat.getColor(context, R.color.settlement_accent))
                holder.expenseAmount.setTextColor(ContextCompat.getColor(context, R.color.settlement_accent))
                holder.paidByLabel.text = "Paid by"
                holder.splitBetweenLabel.text = "Paid to"
                holder.contributorList.text = item.consumers.joinToString(", ") { it.contributorName }
            }
            Item.TYPE_MONEY_TRANSFER -> {
                holder.cardView.setCardBackgroundColor(ContextCompat.getColor(context, R.color.transfer_card_bg))
                holder.cardView.strokeColor = ContextCompat.getColor(context, R.color.transfer_card_stroke)
                holder.expenseMetaPanel.setBackgroundResource(R.drawable.bg_transfer_panel)
                holder.expenseIcon.setBackgroundResource(R.drawable.bg_transfer_icon)
                holder.expenseIcon.text = "⇄"
                holder.expenseIcon.setTextColor(ContextCompat.getColor(context, R.color.transfer_accent))
                holder.expenseAmount.setTextColor(ContextCompat.getColor(context, R.color.transfer_accent))
                holder.paidByLabel.text = "From"
                holder.splitBetweenLabel.text = "To"
                holder.contributorList.text = item.consumers.joinToString(", ") { it.contributorName }
            }
            Item.TYPE_CARRYOVER -> {
                holder.cardView.setCardBackgroundColor(ContextCompat.getColor(context, R.color.carryover_card_bg))
                holder.cardView.strokeColor = ContextCompat.getColor(context, R.color.carryover_card_stroke)
                holder.expenseMetaPanel.setBackgroundResource(R.drawable.bg_carryover_panel)
                holder.expenseIcon.setBackgroundResource(R.drawable.bg_carryover_icon)
                holder.expenseIcon.text = "↺"
                holder.expenseIcon.setTextColor(ContextCompat.getColor(context, R.color.carryover_accent))
                holder.expenseAmount.setTextColor(ContextCompat.getColor(context, R.color.carryover_accent))
                holder.paidByLabel.text = "Owed to"
                holder.splitBetweenLabel.text = "Owed by"
                holder.contributorList.text = item.consumers.joinToString(", ") { it.contributorName }
            }
            else -> {
                holder.cardView.setCardBackgroundColor(ContextCompat.getColor(context, R.color.surface_card))
                holder.cardView.strokeColor = ContextCompat.getColor(context, R.color.card_stroke)
                holder.expenseMetaPanel.setBackgroundResource(R.drawable.bg_nested_panel)
                holder.expenseIcon.setBackgroundResource(R.drawable.bg_icon_bubble)
                holder.expenseIcon.text = "₹"
                holder.expenseIcon.setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                holder.expenseAmount.setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                holder.paidByLabel.text = "Paid by"
                holder.splitBetweenLabel.text = "Split between"
                holder.contributorList.text = if (item.consumers.size > 3) {
                    "Everyone (${item.consumers.size})"
                } else {
                    item.consumers.joinToString(", ") { it.contributorName }
                }
            }
        }

        // Short click behavior (show popup)
        holder.itemView.setOnClickListener {
            showCustomPopup(it, item)
        }

        // Long click on parent card
        holder.itemView.setOnLongClickListener {
            showCustomPopup(it, item)
            true
        }

        // Attach long-press to every descendant so long-press on child triggers the menu too
        attachLongPressToAllChildren(holder.itemView, item)
    }

    private fun attachLongPressToAllChildren(root: View, item: ItemWithPayerAndConsumers) {
        root.isLongClickable = true
        root.setOnLongClickListener {
            showCustomPopup(it, item)
            true
        }

        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                val child = root.getChildAt(i)
                child.isLongClickable = true
                child.setOnLongClickListener {
                    showCustomPopup(it, item)
                    true
                }
                attachLongPressToAllChildren(child, item)
            }
        }
    }

    private fun showCustomPopup(anchorView: View, item: ItemWithPayerAndConsumers) {
        val inflater = LayoutInflater.from(context)
        val popupView = inflater.inflate(R.layout.popup_layout, null)

        val btnEdit = popupView.findViewById<TextView>(R.id.menuEdit)
        val dividerEdit = popupView.findViewById<View>(R.id.dividerEdit)
        val btnDelete = popupView.findViewById<TextView>(R.id.menuDelete)
        val dividerDelete = popupView.findViewById<View>(R.id.dividerDelete)
        val btnDetails = popupView.findViewById<TextView>(R.id.menuDetails)
        val btnShare = popupView.findViewById<View>(R.id.menuShare)
        val dividerShare = popupView.findViewById<View>(R.id.dividerShare)
        val btnClone = popupView.findViewById<View>(R.id.menuClone)
        val dividerClone = popupView.findViewById<View>(R.id.dividerClone)
        btnShare?.visibility = View.GONE
        dividerShare?.visibility = View.GONE
        btnClone?.visibility = View.GONE
        dividerClone?.visibility = View.GONE
        if (isReadOnly) {
            btnEdit?.visibility = View.GONE
            dividerEdit?.visibility = View.GONE
            btnDelete?.visibility = View.GONE
            dividerDelete?.visibility = View.GONE
        }

        val popupWidth = UiSizing.measurePopupWidth(popupView)
        val popupWindow = PopupWindow(
            popupView,
            popupWidth,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        )

        popupWindow.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        popupWindow.elevation = 6f
        UiSizing.applyPopupMorph(popupWindow)
        popupWindow.isOutsideTouchable = true
        popupWindow.isTouchable = true
        popupWindow.isFocusable = true

        if (btnEdit == null || btnDelete == null || btnDetails == null) {
            return
        }

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

        anchorView.post {
            try {
                UiSizing.showAnchoredPopup(anchorView, popupWindow, popupWidth)
            } catch (e: Exception) {
                popupWindow.showAtLocation(anchorView.rootView, android.view.Gravity.CENTER, 0, 0)
            }
        }
    }

    class ExpenseViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val cardView: MaterialCardView = itemView.findViewById(R.id.cardView)
        val expenseIcon: TextView = itemView.findViewById(R.id.expenseIcon)
        val expenseName: TextView = itemView.findViewById(R.id.expenseName)
        val expenseAmount: TextView = itemView.findViewById(R.id.expenseAmount)
        val expenseDate: TextView = itemView.findViewById(R.id.expenseDate)
        val expenseMetaPanel: LinearLayout = itemView.findViewById(R.id.expenseMetaPanel)
        val paidByLabel: TextView = itemView.findViewById(R.id.paidByLabel)
        val payerName: TextView = itemView.findViewById(R.id.payerName)
        val splitBetweenLabel: TextView = itemView.findViewById(R.id.splitBetweenLabel)
        val contributorList: TextView = itemView.findViewById(R.id.contributorList)
    }
}

class ExpenseDiffCallback : DiffUtil.ItemCallback<ItemWithPayerAndConsumers>() {
    override fun areItemsTheSame(oldItem: ItemWithPayerAndConsumers, newItem: ItemWithPayerAndConsumers): Boolean {
        return oldItem.item.itemID == newItem.item.itemID
    }

    override fun areContentsTheSame(oldItem: ItemWithPayerAndConsumers, newItem: ItemWithPayerAndConsumers): Boolean {
        return oldItem == newItem
    }
}

package com.raptor.billsplitter

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.PopupWindow
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raptor.billsplitter.data.ItemWithPayerAndConsumers

class ExpenseAdapter(
    private val context: Context,
    private val onMenuAction: (String, ItemWithPayerAndConsumers) -> Unit
) : ListAdapter<ItemWithPayerAndConsumers, ExpenseAdapter.ExpenseViewHolder>(ExpenseDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ExpenseViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.expense_card, parent, false)
        return ExpenseViewHolder(view)
    }

    override fun onBindViewHolder(holder: ExpenseViewHolder, position: Int) {
        val item = getItem(position)
        holder.expenseName.text = item.item.itemName
        holder.expenseAmount.text = item.item.amount.toString()
        holder.payerName.text = item.payer.contributorName
        holder.contributorList.text = item.consumers.joinToString(", ") { it.contributorName }

        // Short click behavior (if you still want click to show popup)
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

    /**
     * Recursively attaches long click listeners to all child Views inside the given root.
     * The listener shows the popup anchored to the tapped child view.
     */
    private fun attachLongPressToAllChildren(root: View, item: ItemWithPayerAndConsumers) {
        // Make sure root itself is long-clickable
        root.isLongClickable = true
        root.setOnLongClickListener {
            showCustomPopup(it, item)
            true
        }

        if (root is ViewGroup) {
            val vg = root
            for (i in 0 until vg.childCount) {
                val child = vg.getChildAt(i)
                // Attach the same long-click listener to the child
                child.isLongClickable = true
                child.setOnLongClickListener {
                    showCustomPopup(it, item)
                    true
                }
                // recurse into grandchildren
                attachLongPressToAllChildren(child, item)
            }
        }
    }

    private fun showCustomPopup(anchorView: View, item: ItemWithPayerAndConsumers) {
        val inflater = LayoutInflater.from(context)
        val popupView = inflater.inflate(R.layout.popup_layout, null)

        val popupWindow = PopupWindow(
            popupView,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        )

        popupWindow.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        popupWindow.elevation = 10f
        popupWindow.isOutsideTouchable = true
        popupWindow.isTouchable = true
        popupWindow.isFocusable = true

        val btnEdit = popupView.findViewById<TextView>(R.id.menuEdit)
        val btnDelete = popupView.findViewById<TextView>(R.id.menuDelete)
        val btnDetails = popupView.findViewById<TextView>(R.id.menuDetails)

        // Safety checks
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

        // show anchored to the view that was long-pressed
        anchorView.post {
            try {
                popupWindow.showAsDropDown(anchorView, 0, 0)
            } catch (e: Exception) {
                // fallback if showAsDropDown fails
                popupWindow.showAtLocation(anchorView.rootView, android.view.Gravity.CENTER, 0, 0)
            }
        }
    }

    class ExpenseViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val expenseName: TextView = itemView.findViewById(R.id.expenseName)
        val expenseAmount: TextView = itemView.findViewById(R.id.expenseAmount)
        val payerName: TextView = itemView.findViewById(R.id.payerName)
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

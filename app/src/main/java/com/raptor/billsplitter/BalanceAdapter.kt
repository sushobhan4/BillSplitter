package com.raptor.billsplitter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.raptor.billsplitter.data.BalanceCalculator
import java.util.Locale
import kotlin.math.abs

class BalanceAdapter(
    initialBalances: Map<String, Double>,
    private val isReadOnly: Boolean = false,
    private val onMarkAsPaid: (contributorName: String, amountOwed: Double) -> Unit
) : RecyclerView.Adapter<BalanceAdapter.BalanceViewHolder>() {

    private var entries: List<Map.Entry<String, Double>> =
        BalanceCalculator.sortBalanceEntries(initialBalances)

    fun updateBalances(newBalances: Map<String, Double>) {
        entries = BalanceCalculator.sortBalanceEntries(newBalances)
        notifyDataSetChanged()
    }

    class BalanceViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvContributorName: TextView = itemView.findViewById(R.id.tvContributorName)
        val tvBalance: TextView = itemView.findViewById(R.id.tvBalance)
        val btnMarkAsPaid: Button = itemView.findViewById(R.id.btnMarkAsPaid)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BalanceViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.balance_item, parent, false)
        return BalanceViewHolder(view)
    }

    override fun onBindViewHolder(holder: BalanceViewHolder, position: Int) {
        val (contributorName, balance) = entries[position]
        holder.tvContributorName.text = contributorName

        when {
            balance > 0.005 -> {
                holder.tvBalance.text = String.format(Locale.getDefault(), "Will receive \u20B9%,.2f", balance)
                holder.tvBalance.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.receive_text))
                holder.btnMarkAsPaid.visibility = View.GONE
                holder.btnMarkAsPaid.setOnClickListener(null)
            }
            balance < -0.005 -> {
                val owed = abs(balance)
                holder.tvBalance.text = String.format(Locale.getDefault(), "Will give \u20B9%,.2f", owed)
                holder.tvBalance.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.give_text))
                if (isReadOnly) {
                    holder.btnMarkAsPaid.visibility = View.GONE
                    holder.btnMarkAsPaid.setOnClickListener(null)
                } else {
                    holder.btnMarkAsPaid.visibility = View.VISIBLE
                    holder.btnMarkAsPaid.setOnClickListener {
                        onMarkAsPaid(contributorName, owed)
                    }
                }
            }
            else -> {
                holder.tvBalance.text = "Settled up"
                holder.tvBalance.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.text_hint))
                holder.btnMarkAsPaid.visibility = View.GONE
                holder.btnMarkAsPaid.setOnClickListener(null)
            }
        }
    }

    override fun getItemCount() = entries.size
}

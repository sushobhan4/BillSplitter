package com.raptor.billsplitter

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import kotlin.math.abs

class BalanceAdapter(private val balances: Map<String, Double>) :
    RecyclerView.Adapter<BalanceAdapter.BalanceViewHolder>() {

    class BalanceViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvContributorName: TextView = itemView.findViewById(R.id.tvContributorName)
        val tvBalance: TextView = itemView.findViewById(R.id.tvBalance)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BalanceViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.balance_item, parent, false)
        return BalanceViewHolder(view)
    }

    override fun onBindViewHolder(holder: BalanceViewHolder, position: Int) {
        val contributorName = balances.keys.elementAt(position)
        val balance = balances[contributorName] ?: 0.0
        holder.tvContributorName.text = contributorName

        when {
            balance > 0.005 -> {
                holder.tvBalance.text = String.format("Will receive %.2f", balance)
                holder.tvBalance.setTextColor(Color.parseColor("#006400")) // Dark Green
            }
            balance < -0.005 -> {
                holder.tvBalance.text = String.format("Will give %.2f", abs(balance))
                holder.tvBalance.setTextColor(Color.RED)
            }
            else -> {
                holder.tvBalance.text = "Settled up"
                holder.tvBalance.setTextColor(Color.GRAY)
            }
        }
    }

    override fun getItemCount() = balances.size
}
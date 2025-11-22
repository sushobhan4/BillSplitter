package com.raptor.billsplitter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

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
        val balance = balances[contributorName]
        holder.tvContributorName.text = contributorName
        holder.tvBalance.text = String.format("%.2f", balance)
    }

    override fun getItemCount() = balances.size
}

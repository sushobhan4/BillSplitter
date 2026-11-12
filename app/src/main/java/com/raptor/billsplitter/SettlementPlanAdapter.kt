package com.raptor.billsplitter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.raptor.billsplitter.data.SettlementTransfer
import java.util.Locale

class SettlementPlanAdapter(
    initialTransfers: List<SettlementTransfer>,
    private val isReadOnly: Boolean = false,
    private val onMarkTransferPaid: (SettlementTransfer) -> Unit
) : RecyclerView.Adapter<SettlementPlanAdapter.TransferViewHolder>() {

    private var transfers: List<SettlementTransfer> = initialTransfers

    fun updateTransfers(newTransfers: List<SettlementTransfer>) {
        transfers = newTransfers
        notifyDataSetChanged()
    }

    class TransferViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvTransferRoute: TextView = itemView.findViewById(R.id.tvTransferRoute)
        val tvTransferAmount: TextView = itemView.findViewById(R.id.tvTransferAmount)
        val btnMarkTransferPaid: Button = itemView.findViewById(R.id.btnMarkTransferPaid)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TransferViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.settlement_plan_item, parent, false)
        return TransferViewHolder(view)
    }

    override fun onBindViewHolder(holder: TransferViewHolder, position: Int) {
        val transfer = transfers[position]
        holder.tvTransferRoute.text = "${transfer.fromName} \u2192 ${transfer.toName}"
        holder.tvTransferAmount.text = String.format(Locale.getDefault(), "Pay \u20B9%,.2f", transfer.amount)
        if (isReadOnly) {
            holder.btnMarkTransferPaid.visibility = View.GONE
            holder.btnMarkTransferPaid.setOnClickListener(null)
        } else {
            holder.btnMarkTransferPaid.visibility = View.VISIBLE
            holder.btnMarkTransferPaid.setOnClickListener {
                onMarkTransferPaid(transfer)
            }
        }
    }

    override fun getItemCount() = transfers.size
}

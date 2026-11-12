package com.raptor.billsplitter

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.PopupWindow
import android.widget.TextView
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.core.graphics.drawable.toDrawable
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.interpolator.view.animation.FastOutSlowInInterpolator
import androidx.transition.ChangeBounds
import androidx.transition.Fade
import androidx.transition.TransitionManager
import androidx.transition.TransitionSet
import java.util.Locale
import kotlin.math.abs

object UiSizing {

    fun applyDialogMorph(dialog: Dialog) {
        dialog.window?.apply {
            setWindowAnimations(R.style.BillSplitterDialogAnimation)
            @Suppress("DEPRECATION")
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }

    fun applyPopupMorph(popupWindow: PopupWindow) {
        popupWindow.animationStyle = R.style.BillSplitterPopupAnimation
    }

    fun animateMorph(root: ViewGroup?, durationMs: Long = 220L) {
        if (root == null || !root.isLaidOut) return
        val transition = TransitionSet().apply {
            ordering = TransitionSet.ORDERING_TOGETHER
            duration = durationMs
            interpolator = FastOutSlowInInterpolator()
            addTransition(ChangeBounds())
            addTransition(Fade(Fade.OUT))
            addTransition(Fade(Fade.IN))
        }
        TransitionManager.beginDelayedTransition(root, transition)
    }

    fun setVisibilityMorph(view: View, targetVisibility: Int, morphContainer: ViewGroup? = view.parent as? ViewGroup) {
        if (view.visibility == targetVisibility) return
        animateMorph(morphContainer)
        view.visibility = targetVisibility
    }

    fun getSafeWindowRect(context: Context, anchorView: View? = null): Rect {
        val targetView = anchorView ?: (context as? Activity)?.window?.decorView
        val visibleRect = Rect()
        val dm = context.resources.displayMetrics
        if (targetView != null) {
            val root = targetView.rootView
            root.getWindowVisibleDisplayFrame(visibleRect)
            if (visibleRect.width() <= 0 || visibleRect.height() <= 0) {
                visibleRect.set(0, 0, dm.widthPixels, dm.heightPixels)
            }
            val insetsCompat = ViewCompat.getRootWindowInsets(targetView)
                ?: ViewCompat.getRootWindowInsets(root)
            if (insetsCompat != null) {
                val bars = insetsCompat.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                        WindowInsetsCompat.Type.displayCutout() or
                        WindowInsetsCompat.Type.ime()
                )
                val rootLoc = IntArray(2)
                root.getLocationOnScreen(rootLoc)
                val rootW = if (root.width > 0) root.width else dm.widthPixels
                val rootH = if (root.height > 0) root.height else dm.heightPixels
                visibleRect.left = maxOf(visibleRect.left, rootLoc[0] + bars.left)
                visibleRect.top = maxOf(visibleRect.top, rootLoc[1] + bars.top)
                visibleRect.right = minOf(visibleRect.right, rootLoc[0] + rootW - bars.right)
                visibleRect.bottom = minOf(visibleRect.bottom, rootLoc[1] + rootH - bars.bottom)
            }
        } else {
            visibleRect.set(0, 0, dm.widthPixels, dm.heightPixels)
        }
        if (visibleRect.width() <= 0 || visibleRect.height() <= 0) {
            visibleRect.set(0, 0, dm.widthPixels, dm.heightPixels)
        }
        return visibleRect
    }

    fun fitDialogToContent(dialog: Dialog, contentView: View) {
        val safeRect = getSafeWindowRect(contentView.context)
        val margin = dpToPx(contentView.context, 24)
        val maxWindowWidth = (safeRect.width() - margin).coerceAtLeast(1)
        val maxWindowHeight = (safeRect.height() - margin).coerceAtLeast(1)
        contentView.measure(
            View.MeasureSpec.makeMeasureSpec(maxWindowWidth, View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(maxWindowHeight, View.MeasureSpec.AT_MOST)
        )
        val desiredWidth = contentView.measuredWidth.coerceIn(1, maxWindowWidth)
        dialog.window?.setLayout(desiredWidth, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    fun setDialogFullWidth(dialog: Dialog, contentView: View) {
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    fun setDialogWidthFraction(dialog: Dialog, contentView: View, fraction: Float) {
        val safeRect = getSafeWindowRect(contentView.context)
        val desiredWidth = (safeRect.width() * fraction).toInt().coerceIn(1, safeRect.width())
        dialog.window?.setLayout(desiredWidth, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    fun constrainChildMaxHeight(context: Context, view: View, heightFraction: Float = 0.65f) {
        val safeRect = getSafeWindowRect(context)
        val maxH = (safeRect.height() * heightFraction).toInt().coerceAtLeast(dpToPx(context, 160))
        val lp = view.layoutParams
        if (lp is ConstraintLayout.LayoutParams) {
            lp.constrainedHeight = true
            lp.matchConstraintMaxHeight = maxH
            view.layoutParams = lp
        }
    }

    fun measurePopupWidth(popupView: View): Int {
        var maxRowWidth = 0

        fun scan(view: View) {
            if (view is TextView && view.visibility != View.GONE) {
                val textWidth = kotlin.math.ceil(
                    view.paint.measureText(view.text?.toString().orEmpty()).toDouble()
                ).toInt()

                val drawables = view.compoundDrawables
                val relDrawables = view.compoundDrawablesRelative
                val startDrawable = relDrawables[0] ?: drawables[0]
                val endDrawable = relDrawables[2] ?: drawables[2]

                val startWidth = if (startDrawable != null) {
                    val iconW = if (!startDrawable.bounds.isEmpty) {
                        startDrawable.bounds.width()
                    } else {
                        startDrawable.intrinsicWidth.coerceAtLeast(0)
                    }
                    iconW + view.compoundDrawablePadding
                } else 0

                val endWidth = if (endDrawable != null) {
                    val iconW = if (!endDrawable.bounds.isEmpty) {
                        endDrawable.bounds.width()
                    } else {
                        endDrawable.intrinsicWidth.coerceAtLeast(0)
                    }
                    iconW + view.compoundDrawablePadding
                } else 0

                val childPad = maxOf(
                    view.paddingLeft + view.paddingRight,
                    view.paddingStart + view.paddingEnd
                )

                maxRowWidth = maxOf(maxRowWidth, childPad + startWidth + textWidth + endWidth)
            } else if (view is ViewGroup && view.visibility != View.GONE) {
                for (i in 0 until view.childCount) {
                    scan(view.getChildAt(i))
                }
            }
        }

        scan(popupView)
        val containerPad = maxOf(
            popupView.paddingLeft + popupView.paddingRight,
            popupView.paddingStart + popupView.paddingEnd
        )
        return maxRowWidth + containerPad + dpToPx(popupView.context, 4)
    }

    fun showAnchoredPopup(
        anchorView: View,
        popupWindow: PopupWindow,
        popupWidth: Int,
        preferAbove: Boolean = false
    ) {
        val context = anchorView.context
        val safeRect = getSafeWindowRect(context, anchorView)
        val margin = dpToPx(context, 12)
        val gap = dpToPx(context, if (preferAbove) 8 else 4)

        val maxWidth = (safeRect.width() - margin * 2).coerceAtLeast(1)
        val finalWidth = popupWidth.coerceIn(1, maxWidth)
        popupWindow.width = finalWidth

        val maxHeight = (safeRect.height() - margin * 2).coerceAtLeast(1)
        val contentView = popupWindow.contentView
        contentView.measure(
            View.MeasureSpec.makeMeasureSpec(finalWidth, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        )
        val measuredHeight = contentView.measuredHeight.coerceAtLeast(1)
        val finalHeight = measuredHeight.coerceAtMost(maxHeight)
        if (measuredHeight > maxHeight) {
            popupWindow.height = maxHeight
        } else {
            popupWindow.height = ViewGroup.LayoutParams.WRAP_CONTENT
        }

        val anchorLocation = IntArray(2)
        anchorView.getLocationOnScreen(anchorLocation)
        val anchorLeft = anchorLocation[0]
        val anchorTop = anchorLocation[1]
        val anchorRight = anchorLeft + anchorView.width
        val anchorBottom = anchorTop + anchorView.height
        val anchorCenterX = (anchorLeft + anchorRight) / 2

        val preferredX = if (anchorCenterX > (safeRect.left + safeRect.right) / 2) {
            anchorRight - finalWidth
        } else {
            anchorLeft
        }
        val maxX = (safeRect.right - margin - finalWidth).coerceAtLeast(safeRect.left + margin)
        val finalX = preferredX.coerceIn(safeRect.left + margin, maxX)

        val belowY = anchorBottom + gap
        val aboveY = anchorTop - gap - finalHeight
        val spaceBelow = (safeRect.bottom - margin) - (anchorBottom + gap)
        val spaceAbove = (anchorTop - gap) - (safeRect.top + margin)

        val chosenY = if (preferAbove) {
            if (spaceAbove >= finalHeight || spaceAbove >= spaceBelow) aboveY else belowY
        } else {
            if (spaceBelow >= finalHeight || spaceBelow >= spaceAbove) belowY else aboveY
        }
        val maxY = (safeRect.bottom - margin - finalHeight).coerceAtLeast(safeRect.top + margin)
        val finalY = chosenY.coerceIn(safeRect.top + margin, maxY)

        popupWindow.isClippingEnabled = true
        popupWindow.showAtLocation(anchorView.rootView, Gravity.TOP or Gravity.START, finalX, finalY)
    }

    fun measureMaxBalanceRowWidth(context: Context, balances: Map<String, Double>, headerView: View): Int {
        val spec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        headerView.measure(spec, spec)
        var maxWidth = headerView.measuredWidth

        val inflater = LayoutInflater.from(context)
        val rowView = inflater.inflate(R.layout.balance_item, null)
        val tvName = rowView.findViewById<TextView>(R.id.tvContributorName)
        val tvBalance = rowView.findViewById<TextView>(R.id.tvBalance)

        for ((name, balance) in balances) {
            tvName.text = name
            tvBalance.text = when {
                balance > 0.005 -> String.format(Locale.getDefault(), "Will receive \u20B9%,.2f", balance)
                balance < -0.005 -> String.format(Locale.getDefault(), "Will give \u20B9%,.2f", abs(balance))
                else -> "Settled up"
            }
            tvName.measure(spec, spec)
            tvBalance.measure(spec, spec)
            val nameLp = tvName.layoutParams as? ViewGroup.MarginLayoutParams
            val balLp = tvBalance.layoutParams as? ViewGroup.MarginLayoutParams
            val rowWidth = rowView.paddingLeft + rowView.paddingRight +
                tvName.measuredWidth + (nameLp?.marginStart ?: 0) + (nameLp?.marginEnd ?: 0) +
                tvBalance.measuredWidth + (balLp?.marginStart ?: 0) + (balLp?.marginEnd ?: 0)
            maxWidth = maxOf(maxWidth, rowWidth)
        }

        val maxAllowed = context.resources.displayMetrics.widthPixels - dpToPx(context, 76)
        return maxWidth.coerceAtMost(maxAllowed)
    }

    fun dpToPx(context: Context, dp: Int): Int {
        return (dp * context.resources.displayMetrics.density).toInt()
    }

    fun showConfirmDialog(
        context: Context,
        title: String,
        message: String,
        confirmText: String = "Delete",
        cancelText: String = "Cancel",
        onConfirm: () -> Unit
    ) {
        val dialog = Dialog(context)
        val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_confirm_action, null)
        dialog.setContentView(dialogView)
        dialog.window?.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
        applyDialogMorph(dialog)

        dialog.findViewById<TextView>(R.id.tvConfirmTitle).text = title
        dialog.findViewById<TextView>(R.id.tvConfirmMessage).text = message
        val btnCancel = dialog.findViewById<Button>(R.id.btnConfirmCancel)
        val btnProceed = dialog.findViewById<Button>(R.id.btnConfirmProceed)
        btnCancel.text = cancelText
        btnProceed.text = confirmText

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }
        btnProceed.setOnClickListener {
            dialog.dismiss()
            onConfirm()
        }

        setDialogFullWidth(dialog, dialogView)
        dialog.show()
        setDialogFullWidth(dialog, dialogView)
    }
}

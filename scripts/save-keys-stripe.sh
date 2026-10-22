#!/bin/zsh
# Stores the INNOCHEM Stripe secret key in the macOS Keychain (hidden prompt).
# Usage: zsh scripts/save-keys-stripe.sh [live]
mode=${1:-test}
[[ $mode == test || $mode == live ]] || { echo "Użycie: zsh scripts/save-keys-stripe.sh [live]"; exit 1; }
echo "\nStripe klucz z trybu $mode (sk_${mode}_... albo rk_${mode}_...): wklej wartość dwa razy"
security add-generic-password -U -s programo.innochem.stripe-$mode -a innochem -w
echo "\nStripe zapisany. Napisz Claude: klucze są."

#!/bin/bash

echo "Parando CN WiFi..."

sudo systemctl stop opennds 2>/dev/null || true
sudo systemctl stop dnsmasq 2>/dev/null || true

sudo pkill hostapd 2>/dev/null || true
sudo pkill dnsmasq 2>/dev/null || true
sudo pkill node 2>/dev/null || true

sudo iptables -F
sudo iptables -t nat -F

sudo ip addr flush dev wlp6s0 2>/dev/null || true
sudo ip link set wlp6s0 down 2>/dev/null || true

echo "CN WiFi parado."

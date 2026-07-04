#!/bin/bash
set -e

INTERNET_IF="enx66f41e6cd271"
AP_IF="wlp6s0"
AP_IP="10.10.0.1"
SSID="CN WiFi"

cd ~/wifi-caminhao

echo "Limpando ambiente..."
./scripts/parar-cn-wifi.sh || true

sleep 2

echo "Configurando Wi-Fi como ponto de acesso..."
sudo ip link set $AP_IF down
sudo ip addr flush dev $AP_IF
sudo ip addr add $AP_IP/24 dev $AP_IF
sudo ip link set $AP_IF up

cat > /tmp/cnwifi.conf << EOH
interface=$AP_IF
driver=nl80211
ssid=$SSID
hw_mode=g
channel=1
country_code=BR
auth_algs=1
ignore_broadcast_ssid=0
EOH

cat > /tmp/cnwifi-dnsmasq.conf << EOD
interface=$AP_IF
bind-interfaces
dhcp-range=10.10.0.10,10.10.0.100,255.255.255.0,12h
dhcp-option=3,$AP_IP
dhcp-option=6,$AP_IP
address=/status.client/$AP_IP
address=/connectivitycheck.gstatic.com/$AP_IP
address=/clients3.google.com/$AP_IP
address=/neverssl.com/$AP_IP
EOD

sudo mkdir -p /etc/config

sudo tee /etc/config/opennds > /dev/null << EON
config opennds
    option enabled '1'
    option gatewayinterface '$AP_IF'
    option gatewayname 'CN WiFi'
    option gatewayaddress '$AP_IP'
    option gatewayport '2050'
    option maxclients '50'
    option use_outdated_mhd '1'
    option gatewayfqdn 'status.client'
    option allow_preemptive_authentication '0'
    option fasport '5173'
    option fasremoteip '$AP_IP'
    option faspath '/'
    option fas_secure_enabled '0'

list users_to_router 'allow udp port 53'
list users_to_router 'allow udp port 67'
list users_to_router 'allow tcp port 2050'
list users_to_router 'allow tcp port 5173'
list users_to_router 'allow tcp port 3001'
EON

echo "Ativando roteamento..."
sudo sysctl -w net.ipv4.ip_forward=1
sudo iptables -t nat -A POSTROUTING -o $INTERNET_IF -j MASQUERADE

echo "Subindo hostapd..."
sudo hostapd /tmp/cnwifi.conf > logs/hostapd.log 2>&1 &

sleep 3

echo "Subindo dnsmasq..."
sudo dnsmasq --no-daemon -C /tmp/cnwifi-dnsmasq.conf > logs/dnsmasq.log 2>&1 &

sleep 2

echo "Subindo backend..."
cd ~/wifi-caminhao/backend
npm run dev > ../logs/backend.log 2>&1 &

sleep 2

echo "Subindo frontend..."
cd ~/wifi-caminhao/frontend
npm run dev -- --host $AP_IP > ../logs/frontend.log 2>&1 &

sleep 4

echo "Subindo OpenNDS..."
sudo systemctl restart opennds || true

sleep 5

echo ""
echo "STATUS:"
sudo ndsctl status || true

echo ""
echo "CN WiFi iniciado."
echo "Cliente: http://10.10.0.1:5173"
echo "Admin:   http://10.10.0.1:5173/admin"
echo "Backend: http://10.10.0.1:3001"

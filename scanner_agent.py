"""
Scanner Agent — ERP ITP
Expõe o scanner local (WIA) como endpoint HTTP para o sistema web.

Distribuição: compilado em um único .exe (PyInstaller) que se auto-instala
na primeira execução — nenhuma instalação manual ou Python é necessária
na máquina do usuário final.

Build (apenas para quem gera o executável):
    pip install pyinstaller pywin32 flask flask-cors
    pyinstaller --onefile --noconsole --name ITP-Scanner-Agent scanner_agent.py

Uso local sem empacotar (dev):
    pip install pywin32 flask flask-cors
    python scanner_agent.py
"""

import base64
import ctypes
import os
import shutil
import socket
import sys
import tempfile
import winreg

import pythoncom
import win32com.client
from flask import Flask, jsonify
from flask_cors import CORS

APP_NAME = "ITPScannerAgent"
PROTOCOL = "itpscan"
PORT = 7734
INSTALL_DIR = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "ITPScannerAgent")
INSTALL_PATH = os.path.join(INSTALL_DIR, "ITP-Scanner-Agent.exe")


def _is_frozen() -> bool:
    """True quando rodando como .exe empacotado (PyInstaller), não como script .py."""
    return getattr(sys, "frozen", False)


def _current_exe_path() -> str:
    return sys.executable if _is_frozen() else os.path.abspath(__file__)


def self_install():
    """
    Primeira execução: copia o .exe para uma pasta permanente, registra o
    protocolo itpscan:// e adiciona ao início do Windows. Idempotente —
    seguro rodar em toda inicialização (repara registros apagados/quebrados).
    """
    if not _is_frozen():
        return  # em modo dev (python scanner_agent.py) não se auto-instala

    current = _current_exe_path()
    try:
        os.makedirs(INSTALL_DIR, exist_ok=True)

        primeira_instalacao = not os.path.exists(INSTALL_PATH)

        if os.path.abspath(current) != os.path.abspath(INSTALL_PATH):
            shutil.copy2(current, INSTALL_PATH)

        # Protocolo itpscan:// -> abre/inicia o agente
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{PROTOCOL}") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:ITP Scanner Protocol")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{PROTOCOL}\shell\open\command") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{INSTALL_PATH}"')

        # Inicia com o Windows
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run") as k:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, f'"{INSTALL_PATH}"')

        if primeira_instalacao:
            ctypes.windll.user32.MessageBoxW(
                0,
                "O ITP Scanner Agent foi instalado com sucesso!\n\n"
                "Ele vai iniciar automaticamente com o Windows a partir de agora.\n"
                "Você já pode fechar esta janela e usar o botão de digitalizar no sistema.",
                "ITP Scanner Agent",
                0x40,  # MB_ICONINFORMATION
            )
    except Exception as e:
        # Auto-instalação é best-effort — se falhar (ex.: sem permissão),
        # o agente ainda funciona manualmente nesta sessão.
        try:
            ctypes.windll.user32.MessageBoxW(
                0,
                f"Não foi possível concluir a instalação automática:\n{e}\n\n"
                "O scanner funcionará apenas enquanto esta janela estiver aberta.",
                "ITP Scanner Agent — Aviso",
                0x30,  # MB_ICONWARNING
            )
        except Exception:
            pass


app = Flask(__name__)
CORS(app, origins=[
    "http://localhost:3000",
    "http://localhost:3001",
    "https://itp.institutotiapretinha.org",
])


@app.route("/status")
def status():
    return jsonify({"ok": True, "version": "1.0", "service": "scanner-agent-itp"})


@app.route("/scan")
def scan():
    pythoncom.CoInitialize()
    try:
        wia = win32com.client.Dispatch("WIA.CommonDialog")
        # ShowAcquireImage(DeviceType, Intent, Bias, FormatID, AlwaysSelectDevice, UseCommonUI, CancelError)
        image = wia.ShowAcquireImage(
            1,       # ScannerDeviceType
            1,       # ColorIntent
            2,       # MinimizeSize bias
            "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}",  # JPEG
            False,   # AlwaysSelectDevice
            True,    # UseCommonUI (diálogo nativo do Windows)
            False,   # CancelError — retorna None ao cancelar, não lança exceção
        )

        if image is None:
            return jsonify({"error": "cancelled"}), 400

        # Diretorio exclusivo em vez de mktemp (corrida no nome); o WIA exige que o arquivo nao exista.
        tmp_dir = tempfile.mkdtemp(prefix="itp-scan-")
        try:
            tmp = os.path.join(tmp_dir, "digitalizado.jpg")
            image.SaveFile(tmp)
            with open(tmp, "rb") as f:
                data = base64.b64encode(f.read()).decode()
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return jsonify({
            "ok": True,
            "data": f"data:image/jpeg;base64,{data}",
            "mimetype": "image/jpeg",
            "filename": "digitalizado.jpg",
        })

    except Exception as e:
        msg = str(e)
        # WIA error 0x80210015 = nenhum scanner disponível
        if "0x80210015" in msg or "No scanner" in msg.lower():
            return jsonify({"error": "Nenhum scanner encontrado. Verifique se está ligado e conectado."}), 503
        print(f"Falha ao digitalizar: {msg}", file=sys.stderr)
        return jsonify({"error": "Falha ao digitalizar. Tente novamente."}), 500

    finally:
        pythoncom.CoUninitialize()


def _ja_esta_rodando() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


if __name__ == "__main__":
    self_install()
    if _ja_esta_rodando():
        sys.exit(0)  # já tem uma instância ativa — não inicia outra
    print("=" * 52)
    print("  Scanner Agent — ERP ITP")
    print(f"  Rodando em http://localhost:{PORT}")
    print("  Ctrl+C para parar")
    print("=" * 52)
    app.run(host="127.0.0.1", port=PORT, debug=False)

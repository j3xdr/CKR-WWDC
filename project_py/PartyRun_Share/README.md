# Party Run Farm — Share Pack

แจกได้แค่โฟลเดอร์นี้ — สคริปต์รันได้เอง ไม่ต้องมีไฟล์อื่นในโปรเจกต์

## ไฟล์ในโฟลเดอร์

| ไฟล์ | ใช้ทำอะไร |
|------|-----------|
| `partyrun_single_file.py` | สคริปต์หลัก (ครบในไฟล์เดียว) |
| `requirements.txt` | แพ็กเกจ Python ที่ต้องติดตั้ง |
| `README.md` | คู่มือนี้ |

**อย่าแจก** `ID.md` / ไฟล์เทส / log — มีบัญชีและข้อมูลภายใน

## วิธีใช้

1. ติดตั้ง Python 3.9+
2. ติดตั้ง dependency:

```bash
pip install -r requirements.txt
```

3. เปิด `partyrun_single_file.py` แล้วแก้ CONFIG ด้านบน:

```python
EMAIL    = "your_email@example.com"
PASSWORD = "your_password"

SCORE    = 800000
COIN     = 449000   # แนะนำไม่เกินนี้
EXP      = 52000    # แนะนำไม่เกินนี้
```

4. รัน:

```bash
python partyrun_single_file.py
```

บัญชีต้องผูก DevPlay แบบอีเมล/รหัสผ่านในเกมแล้ว และต้องมีตั๋ว Party Run

## เพดานที่เทสแล้ว (อย่าเกิน)

| | ผ่าน | ไม่ผ่าน |
|---|---|---|
| **Coin** | ≤ **449,000** | ≥ 490,000 |
| **EXP** | ≤ **52,000** | ≥ 59,000 |

เกินแล้วมักเจอ `INVALID PLAY` / `REWARD EXCEPTION`  
EXP สูงมากอาจค้าง pending แบบ corrupt จนต้องรอรีเซ็ตรายวัน

## ปัญหาที่พบบ่อย

| อาการ | แก้ |
|------|-----|
| `LOGIN FAILED` | อีเมล/รหัสผิด หรือยังไม่ผูก DevPlay email |
| `ERROR_CODE_NOT_ENOUGH_TICKET` | ตั๋ว Party Run หมด — รอรีเซ็ต/เติมอีกครั้ง |
| `INVALID PLAY` | ลด `COIN` / `EXP` ลง |
| `could not claim` | รันใหม่ — ขั้นเคลียร์ pending จะพยายามเคลมต่อ |
| `CORRUPT pending reward` | รอ daily/season reset แล้วค่อยรันใหม่ด้วย EXP ต่ำ |

// Demonstration messages for each channel. All names, numbers and domains are fictional.

const sms = (label, text, senderId) => ({ label, text, details: { source: 'SMS', senderId } });
const wa = (label, text, senderNumber, unknownContact, forwardedManyTimes) =>
    ({ label, text, details: { source: 'WHATSAPP', senderNumber, unknownContact, forwardedManyTimes } });
const upi = (label, text, requestType, payeeVpa, amount) => ({ label, text, details: { source: 'UPI', requestType, payeeVpa, amount } });
const email = (label, text, fromAddress, subject) => ({ label, text, details: { source: 'EMAIL', fromAddress, subject } });

export const SAMPLES = {
    SMS: [
        sms('Genuine OTP from bank header', 'Your OTP for login is 482913. It is valid for 5 minutes. Do not share it with anyone. - HDFC Bank', 'AX-HDFCBK-S'),
        sms('Fake KYC block from mobile number', 'Dear SBI customer, your YONO account will be blocked today. Update PAN/KYC immediately: http://sbi-kyc-update.xyz/login', '+91 93456 12780'),
        sms('Electricity disconnection', 'Dear consumer, your electricity power will be disconnected tonight at 9:30 pm because your previous month bill was not updated. Please immediately contact our electricity officer 9876501234.', '+91 87650 43219'),
        sms('Parcel customs fee (wrong header)', 'India Post: Your parcel is held at the warehouse due to incomplete address. Pay customs fee of Rs 25 at https://bit.ly/ip-redeliver within 24 hours.', 'VK-PSTDLV'),
        sms('Normal delivery update', 'Your order #40512 has been shipped and will arrive by Friday. Track it in the app.', 'JD-AMAZON-S'),
    ],
    WHATSAPP: [
        wa('Part-time task job (international)', 'Hello! I am Priya from a digital marketing agency. We offer a part-time job: like YouTube videos and earn Rs 3,000 daily. Join our Telegram: https://t.me/earn_tasks_daily', '+84 912 345 678', true, false),
        wa("'Hi Mom, new number'", "Hi mom, this is my new number, my phone broke. I need to pay a bill urgently, can you send Rs 18,500 to this UPI? Will return tomorrow. Don't tell dad.", '+91 70123 45678', true, false),
        wa('Digital arrest threat', 'This is Mumbai Police cyber crime branch. A parcel in your name contains drugs and fake passports. An arrest warrant is issued. Join video call for statement and do not tell anyone or you will be arrested.', '+91 63000 11223', true, false),
        wa('Viral free-recharge forward', 'Government is giving FREE 3 months recharge to all Indian users! Click here to claim before offer ends today: www.free-recharge-yojana.online', '+91 98111 22334', false, true),
        wa('Friend making plans', "Hey! Are we still meeting at the library at 5? I'll bring the notes for tomorrow's exam.", '+91 98450 67890', false, false),
    ],
    UPI: [
        upi("Collect request labelled 'refund'", 'Refund of Rs 4,999 for your cancelled order. Approve to receive money in your account.', 'COLLECT_REQUEST', 'amazon.refund.desk@ybl', '4999'),
        upi('Cashback via QR code', 'Congratulations! You won Rs 2,000 cashback. Scan the QR code and enter your UPI PIN to receive the money.', 'UNKNOWN', 'rewards.cashback@paytm', null),
        upi("'Sent by mistake' request", "Sir I sent Rs 10,000 to your number by mistake, please return it urgently, it was for my mother's hospital bill.", 'COLLECT_REQUEST', 'rahul.k1990@okaxis', '10000'),
        upi('Genuine split-bill request', 'Dinner at Sagar Ratna - your share', 'COLLECT_REQUEST', 'ananya.sharma@okhdfcbank', '450'),
    ],
    EMAIL: [
        email('Income-tax refund phishing', 'Dear taxpayer, you are eligible for an income tax refund of Rs 15,490. Verify your bank account details within 24 hours to receive it: http://incometax-refund-gov.in.verify-status.top/claim',
            'Income Tax Department <refunds.incometax@gmail.com>', 'URGENT: Refund approved - action required'),
        email('Fake invoice attachment', 'Please find attached your pending invoice. Open Invoice_8812.html to view and pay before your account is suspended.',
            'HDFC Bank Billing <billing@hdfc-secure-alerts.com>', 'Final notice: invoice overdue'),
        email('Genuine college newsletter', 'Hello students, the semester timetable has been published on the college portal. Contact the office for any changes.',
            'Exam Cell <exams@college.example.edu>', 'Semester timetable published'),
    ],
};

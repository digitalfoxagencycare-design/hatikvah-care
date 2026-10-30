import crypto from "node:crypto";
import { calcTotals, amountInWords, nextNumber, todayIST, addDays } from "./lib/gst.js";
import { customerSnapshot, priced, moveStock, recordPayment } from "./lib/sales.js";

const token = () => crypto.randomBytes(18).toString("base64url");
const now = () => new Date().toISOString();

export async function seedDemoData(store, log = console, cfg = {}) {
  if (cfg.prod || process.env.NODE_ENV === "production") throw new Error("Demo seeding is forbidden in production");
  if (process.env.NODE_ENV === "test") return;
  if ((await store.customers.count()) >= 10 && (await store.quotes.count()) >= 10 && (await store.invoices.count()) >= 10) return;

  log.info?.("[seedDemo] Seeding rich mock data (10+ records for all modules)...");

  // 1. EXL Marketing Products from the client's official bill
  const exlProducts = [
    {
      name: "BIO Red Grapefruit & Kopou Phui Shower Gel 380ml (Boutique Royal) Refillable",
      sku: "BIO-SHW-380",
      category: "hotel-amenities",
      pack: "380ml bottle",
      description: "Premium refreshing shower gel infused with wild red grapefruit and kopou phui botanical extracts. Formulated for luxury hotels, resorts, and healthcare wellness.",
      price: 22500, // ₹225.00
      unit: "NOS",
      hsn: "3304",
      gstRate: 18,
      stockTracked: true,
      active: true,
    },
    {
      name: "BIO Red Grapefruit & Kopou Phui Hair Shampoo 380ml (Biotique Royal) Refillable",
      sku: "BIO-SHM-380",
      category: "hotel-amenities",
      pack: "380ml bottle",
      description: "Nourishing hotel guest hair shampoo with clarifying botanical ingredients. Refillable eco-friendly luxury bottle.",
      price: 22500, // ₹225.00
      unit: "NOS",
      hsn: "3401",
      gstRate: 18,
      stockTracked: true,
      active: true,
    },
    {
      name: "BIO Red Grapefruit & Kopou Phui Hand Wash 380ml (Biotique Royal) Refillable",
      sku: "BIO-HDW-380",
      category: "hygiene-disposables",
      pack: "380ml bottle",
      description: "Antimicrobial gentle luxury hand wash formulated with skin moisturizers and fresh natural extracts.",
      price: 22500, // ₹225.00
      unit: "NOS",
      hsn: "34013019",
      gstRate: 18,
      stockTracked: true,
      active: true,
    },
    {
      name: "BIO Kopou Phul - Brackets",
      sku: "BIO-BRK-001",
      category: "hotel-amenities",
      pack: "Wall-mount bracket set",
      description: "Stainless steel and heavy-duty tamper-proof wall mounting bracket set for 380ml amenity dispenser bottles.",
      price: 21500, // ₹215.00
      unit: "NOS",
      hsn: "39269099",
      gstRate: 18,
      stockTracked: true,
      active: true,
    },
  ];

  for (const ep of exlProducts) {
    const existing = await store.products.findBy("sku", ep.sku);
    if (!existing) {
      await store.products.insert({
        ...ep,
        slug: ep.sku.toLowerCase(),
        images: ["/brand/exl-logo.jpg"],
        reorderLevel: 20,
        reorderQty: 100,
        order: 1,
        createdAt: now(),
        updatedAt: now(),
      });
    }
  }

  // 2. 10 Customers (Leading with CAVE COMPANY from bill)
  const customersData = [
    {
      name: "CAVE COMPANY",
      contactName: "Purchase Manager",
      phone: "9928355320",
      email: "procurement@cavecompany.in",
      gstin: "36AAVFC1701H1ZI",
      stateCode: "36",
      billingAddress: "1-4-B-75, Sainikpuri, Secunderabad, Medchal Malkajgiri, TELANGANA, 500094",
      shippingAddress: "1-4-B-75, Sainikpuri, Secunderabad, Medchal Malkajgiri, TELANGANA, 500094",
      paymentTermsDays: 15,
      active: true,
    },
    {
      name: "Apollo Clinic (Jubilee Hills)",
      contactName: "Dr. K. Srinivas",
      phone: "9849012345",
      email: "admin.jhills@apolloclinic.com",
      gstin: "36AAACA1234A1Z5",
      stateCode: "36",
      billingAddress: "Road No. 36, Jubilee Hills, Hyderabad, Telangana 500033",
      paymentTermsDays: 30,
      active: true,
    },
    {
      name: "Rainbow Children's Medicare",
      contactName: "Sunitha Rao",
      phone: "9848022338",
      email: "purchase@rainbowhospitals.in",
      gstin: "36AAACR5678B1Z2",
      stateCode: "36",
      billingAddress: "Road No. 2, Banjara Hills, Hyderabad, Telangana 500034",
      paymentTermsDays: 15,
      active: true,
    },
    {
      name: "Care & Cure Multispeciality Clinic",
      contactName: "Dr. Rajesh Varma",
      phone: "9988776655",
      email: "careandcure.hyd@gmail.com",
      gstin: "36AAACC9012C1Z8",
      stateCode: "36",
      billingAddress: "Gachibowli Main Road, Near Bio-Diversity Park, Hyderabad, Telangana 500032",
      paymentTermsDays: 30,
      active: true,
    },
    {
      name: "Dr. Ramesh Kumar Senior Living Home",
      contactName: "Col. Ramesh Kumar",
      phone: "9876543210",
      email: "eldercare.ramesh@gmail.com",
      gstin: "",
      stateCode: "36",
      billingAddress: "Plot 88, Vittal Rao Nagar, Madhapur, Hyderabad, Telangana 500081",
      paymentTermsDays: 15,
      active: true,
    },
    {
      name: "Sunrise Home Healthcare Services",
      contactName: "P. Venkat Reddy",
      phone: "9123456780",
      email: "venkat@sunrisehealth.org",
      gstin: "36AAACS1234D1Z7",
      stateCode: "36",
      billingAddress: "12-2-417, St. Ann's Road, Secunderabad, Telangana 500003",
      paymentTermsDays: 15,
      active: true,
    },
    {
      name: "Prime Diagnostics & Surgical Centre",
      contactName: "Mahesh Babu",
      phone: "9345678901",
      email: "accounts@primediagnostics.in",
      gstin: "36AAACP9876E1Z0",
      stateCode: "36",
      billingAddress: "KPHB Colony Phase 3, Kukatpally, Hyderabad, Telangana 500072",
      paymentTermsDays: 30,
      active: true,
    },
    {
      name: "Healing Touch Assisted Living",
      contactName: "Sister Mary",
      phone: "9456789012",
      email: "healingtouch.kondapur@gmail.com",
      gstin: "",
      stateCode: "36",
      billingAddress: "Whitefields, Kondapur, Hyderabad, Telangana 500084",
      paymentTermsDays: 15,
      active: true,
    },
    {
      name: "Lifeline Pharmacy & Medical Stores",
      contactName: "G. Anand",
      phone: "9567890123",
      email: "lifeline.begumpet@gmail.com",
      gstin: "36AAACL4321F1Z6",
      stateCode: "36",
      billingAddress: "Prajay Towers, Begumpet, Hyderabad, Telangana 500016",
      paymentTermsDays: 20,
      active: true,
    },
    {
      name: "Mother Teresa Old Age Home & Palliative Care",
      contactName: "Fr. Thomas",
      phone: "9789012345",
      email: "motherteresa.dilsukhnagar@gmail.com",
      gstin: "",
      stateCode: "36",
      billingAddress: "Chaitanyapuri, Dilsukhnagar, Hyderabad, Telangana 500060",
      paymentTermsDays: 30,
      active: true,
    },
  ];

  for (const c of customersData) {
    const existing = await store.customers.findBy("phone", c.phone);
    if (!existing) {
      await store.customers.insert({ ...c, createdAt: now(), updatedAt: now() });
    }
  }

  // 3. 10 Suppliers
  const suppliersData = [
    { name: "Biotique Royal Luxury Supplies", contact: "Rajesh Sharma", phone: "9811122233", email: "orders@biotiqueroyal.in", gstin: "27AABCB1122D1ZK", stateCode: "27", address: "Andheri East, Mumbai, Maharashtra" },
    { name: "MedTech Healthcare Ltd", contact: "Vikram Patel", phone: "9822233344", email: "medtech.hyd@gmail.com", gstin: "36AABCM3344E1ZL", stateCode: "36", address: "Balanagar Industrial Area, Hyderabad" },
    { name: "CarePro Disposables & Hygiene", contact: "Anil Shetty", phone: "9833344455", email: "sales@carepro.in", gstin: "29AABCC5566F1ZM", stateCode: "29", address: "Peenya Industrial Area, Bengaluru" },
    { name: "Global Rehab & Mobility Devices", contact: "Sunita Gupta", phone: "9844455566", email: "rehab.global@gmail.com", gstin: "07AABCG7788G1ZN", stateCode: "07", address: "Okhla Industrial Area, New Delhi" },
    { name: "Pulse Diagnostics Instruments", contact: "Karthik Raman", phone: "9855566677", email: "pulsediagnostics@yahoo.com", gstin: "33AABCP9900H1ZO", stateCode: "33", address: "Guindy, Chennai, Tamil Nadu" },
    { name: "Apex Surgical Supplies", contact: "Jatin Mehta", phone: "9866677788", email: "apex.surgicals@gmail.com", gstin: "24AABCA1234I1ZP", stateCode: "24", address: "GIDC Vatva, Ahmedabad, Gujarat" },
    { name: "SafeHands Medical Gloves", contact: "Thomas Kurian", phone: "9877788899", email: "sales@safehandsgloves.com", gstin: "32AABCS5678J1ZQ", stateCode: "32", address: "Kochi, Kerala" },
    { name: "Prime Hospital Furnishings", contact: "Deepak Shinde", phone: "9888899900", email: "primehospitalfurn@gmail.com", gstin: "27AABCP9012K1ZR", stateCode: "27", address: "Chakan MIDC, Pune, Maharashtra" },
    { name: "LifeCare Respiratory Devices", contact: "Manoj Joshi", phone: "9899900011", email: "lifecareresp@gmail.com", gstin: "36AABCL3456L1ZS", stateCode: "36", address: "Nacharam, Hyderabad, Telangana" },
    { name: "ZenCare Elderly Care Essentials", contact: "Anitha Reddy", phone: "9800011122", email: "zencare.essentials@gmail.com", gstin: "36AABCZ7890M1ZT", stateCode: "36", address: "Cherlapally, Hyderabad, Telangana" },
  ];

  for (const s of suppliersData) {
    const existing = await store.suppliers.findBy("phone", s.phone);
    if (!existing) {
      await store.suppliers.insert({ ...s, createdAt: now(), updatedAt: now() });
    }
  }

  // 4. 10 Enquiries
  const enquiriesData = [
    { name: "Dr. K. Srinivas", company: "Apollo Clinic (Jubilee Hills)", phone: "9849012345", email: "admin.jhills@apolloclinic.com", message: "Need rates for 50 boxes of Examination Gloves (M & L) and 20 packs of Face Masks.", status: "assigned", assignedTo: "ravi@demo.local", createdAt: now() },
    { name: "Sunitha Rao", company: "Rainbow Children's Medicare", phone: "9848022338", email: "purchase@rainbowhospitals.in", message: "Requirement for 5 Foldable Wheelchairs and 3 Commode Chairs for pediatric rehab wing.", status: "replied", assignedTo: "priya@demo.local", createdAt: now() },
    { name: "Dr. Rajesh Varma", company: "Care & Cure Clinic", phone: "9988776655", email: "careandcure.hyd@gmail.com", message: "Need rates for 10 Digital BP Monitors and 15 Pulse Oximeters with warranty.", status: "new", createdAt: now() },
    { name: "Col. Ramesh Kumar", company: "Dr. Ramesh Senior Living", phone: "9876543210", email: "eldercare.ramesh@gmail.com", message: "Monthly bulk order for Adult Diapers (Large & XL) and Bed Underpads 60x90.", status: "converted", createdAt: now() },
    { name: "P. Venkat Reddy", company: "Sunrise Home Healthcare", phone: "9123456780", email: "venkat@sunrisehealth.org", message: "Looking for Hospital Bed 2-function with foam mattress and side rails.", status: "assigned", assignedTo: "ravi@demo.local", createdAt: now() },
    { name: "Mahesh Babu", company: "Prime Diagnostics", phone: "9345678901", email: "accounts@primediagnostics.in", message: "Quotation needed for 100 units IV Cannula and 50 units Infusion Sets.", status: "new", createdAt: now() },
    { name: "Sister Mary", company: "Healing Touch Assisted Living", phone: "9456789012", email: "healingtouch.kondapur@gmail.com", message: "Requirement for Anti-Decubitus Air Mattress with pump for bedridden patients.", status: "replied", assignedTo: "priya@demo.local", createdAt: now() },
    { name: "G. Anand", company: "Lifeline Pharmacy", phone: "9567890123", email: "lifeline.begumpet@gmail.com", message: "Bulk purchase inquiry for Nebulizer machines and Stethoscopes.", status: "converted", createdAt: now() },
    { name: "Fr. Thomas", company: "Mother Teresa Home", phone: "9789012345", email: "motherteresa.dilsukhnagar@gmail.com", message: "Donation project requirement: 20 Commode Stools and 30 Urine Bags.", status: "new", createdAt: now() },
    { name: "Purchase Dept", company: "CAVE COMPANY", phone: "9928355320", email: "procurement@cavecompany.in", message: "Refillable Boutique Royal Shower Gel, Shampoo and Hand Wash bottles with wall brackets.", status: "converted", createdAt: now() },
  ];

  if ((await store.enquiries.count()) < 10) {
    for (const e of enquiriesData) {
      await store.enquiries.insert({ ...e, items: [], unread: false, activities: [] });
    }
  }

  // 5. Quote EST-46 & Invoice INV2627/393 (Exact match from client's PDF)
  const cave = (await store.customers.findBy("name", "CAVE COMPANY")) || customersData[0];
  const allProds = await store.products.all();
  const shw = allProds.find((p) => p.sku === "BIO-SHW-380") || exlProducts[0];
  const shm = allProds.find((p) => p.sku === "BIO-SHM-380") || exlProducts[1];
  const hdw = allProds.find((p) => p.sku === "BIO-HDW-380") || exlProducts[2];
  const brk = allProds.find((p) => p.sku === "BIO-BRK-001") || exlProducts[3];

  if (!(await store.quotes.findBy("number", "EST-46"))) {
    const est46Items = [
      { productId: shw.id, sku: shw.sku, name: shw.name, hsn: shw.hsn, qty: 4, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: shm.id, sku: shm.sku, name: shm.name, hsn: shm.hsn, qty: 4, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: hdw.id, sku: hdw.sku, name: hdw.name, hsn: hdw.hsn, qty: 6, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: brk.id, sku: brk.sku, name: brk.name, hsn: brk.hsn, qty: 13, unit: "NOS", rate: 21500, discountPct: 0, gstRate: 18 },
    ];
    const doc46 = await priced(store, { items: est46Items, customer: cave, placeOfSupply: "36" });
    await store.quotes.insert({
      number: "EST-46",
      token: token(),
      customerId: cave.id,
      customer: customerSnapshot(cave),
      date: "2026-10-14",
      validUntil: "2026-10-14",
      ...doc46,
      amountInWords: amountInWords(doc46.totals.total),
      status: "accepted",
      version: 1,
      notes: "We declare that this quotation shows the actual price of the goods described and that all particulars are true and correct.",
      terms: "1. Prices are exclusive of freight unless stated.\n2. Delivery within 7–10 working days of order confirmation.",
      createdBy: "admin@hatikvah-care",
      createdAt: "2026-10-14T10:00:00Z",
      updatedAt: "2026-10-14T10:00:00Z",
    });
  }

  if (!(await store.invoices.findBy("number", "INV2627/393"))) {
    const inv393Items = [
      { productId: shw.id, sku: shw.sku, name: shw.name, hsn: shw.hsn, qty: 4, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: shm.id, sku: shm.sku, name: shm.name, hsn: shm.hsn, qty: 4, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: hdw.id, sku: hdw.sku, name: hdw.name, hsn: hdw.hsn, qty: 6, unit: "NOS", rate: 22500, discountPct: 0, gstRate: 18 },
      { productId: brk.id, sku: brk.sku, name: brk.name, hsn: brk.hsn, qty: 14, unit: "NOS", rate: 21500, discountPct: 0, gstRate: 18 },
    ];
    const doc393 = await priced(store, { items: inv393Items, customer: cave, placeOfSupply: "36" });
    const inv393 = await store.invoices.insert({
      number: "INV2627/393",
      token: token(),
      customerId: cave.id,
      customer: customerSnapshot(cave),
      date: "2026-10-16",
      dueDate: "2026-10-16",
      ...doc393,
      amountInWords: amountInWords(doc393.totals.total),
      status: "paid",
      amountPaid: doc393.totals.total,
      notes: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
      createdBy: "admin@hatikvah-care",
      createdAt: "2026-10-16T11:30:00Z",
      updatedAt: "2026-10-16T11:30:00Z",
    });

    await recordPayment(store, inv393, {
      amount: doc393.totals.total,
      date: "2026-10-16",
      mode: "bank",
      reference: "SBI42157988420-NEFT",
      notes: "Full payment received via State Bank of India",
      by: "admin@hatikvah-care",
    });

    for (const it of inv393Items) {
      await moveStock(store, {
        productId: it.productId,
        sku: it.sku,
        qty: -it.qty,
        kind: "out",
        ref: "INV2627/393",
        note: `Dispatched on Tax Invoice INV2627/393 to CAVE COMPANY`,
        by: "admin@hatikvah-care",
      });
    }
  }

  // 6. Ensure total 10 Quotes and 10 Invoices
  const allCusts = await store.customers.all();
  const additionalItems = [
    { sku: "BIO-SHW-380", name: "BIO Red Grapefruit Shower Gel 380ml", hsn: "3304", rate: 22500, unit: "NOS", gstRate: 18 },
    { sku: "BIO-SHM-380", name: "BIO Red Grapefruit Hair Shampoo 380ml", hsn: "3401", rate: 22500, unit: "NOS", gstRate: 18 },
    { sku: "BIO-HDW-380", name: "BIO Red Grapefruit Hand Wash 380ml", hsn: "34013019", rate: 22500, unit: "NOS", gstRate: 18 },
    { sku: "BIO-BRK-001", name: "BIO Kopou Phul - Brackets", hsn: "39269099", rate: 21500, unit: "NOS", gstRate: 18 },
  ];

  if ((await store.quotes.count()) < 10) {
    const quoteTemplates = [
      { cust: allCusts[1] || cave, status: "sent", daysAgo: 2, items: [additionalItems[0], additionalItems[1]], notes: "Special clinic pricing applied" },
      { cust: allCusts[2] || cave, status: "accepted", daysAgo: 3, items: [additionalItems[2], additionalItems[3]], notes: "Pediatric rehab wing requirement" },
      { cust: allCusts[3] || cave, status: "draft", daysAgo: 1, items: [additionalItems[0], additionalItems[2]], notes: "Diagnostic instruments package" },
      { cust: allCusts[4] || cave, status: "sent", daysAgo: 4, items: [additionalItems[1], additionalItems[3]], notes: "Elder care monthly supplies" },
      { cust: allCusts[5] || cave, status: "draft", daysAgo: 2, items: [additionalItems[0], additionalItems[3]], notes: "Home healthcare patient setup" },
      { cust: allCusts[6] || cave, status: "accepted", daysAgo: 5, items: [additionalItems[1], additionalItems[2]], notes: "Surgical and diagnostics supply" },
      { cust: allCusts[7] || cave, status: "sent", daysAgo: 6, items: [additionalItems[0], additionalItems[1]], notes: "Assisted living routine replenishment" },
      { cust: allCusts[8] || cave, status: "draft", daysAgo: 1, items: [additionalItems[2], additionalItems[3]], notes: "Retail pharmacy display order" },
      { cust: allCusts[9] || cave, status: "accepted", daysAgo: 7, items: [additionalItems[0], additionalItems[2]], notes: "Non-profit charity discount applied" },
    ];

    for (let i = 0; i < quoteTemplates.length && (await store.quotes.count()) < 10; i++) {
      const qt = quoteTemplates[i];
      const qNum = await nextNumber(store, "Q");
      const qDate = addDays(todayIST(), -qt.daysAgo);
      const lines = qt.items.map((it) => ({
        productId: it.sku,
        sku: it.sku,
        name: it.name,
        hsn: it.hsn,
        qty: Math.floor(Math.random() * 5) + 2,
        unit: it.unit,
        rate: it.rate,
        discountPct: 5,
        gstRate: it.gstRate,
      }));
      const doc = await priced(store, { items: lines, customer: qt.cust, placeOfSupply: qt.cust.stateCode || "36" });
      await store.quotes.insert({
        number: qNum,
        token: token(),
        customerId: qt.cust.id,
        customer: customerSnapshot(qt.cust),
        date: qDate,
        validUntil: addDays(qDate, 15),
        ...doc,
        amountInWords: amountInWords(doc.totals.total),
        status: qt.status,
        version: 1,
        notes: qt.notes,
        terms: "1. Delivery within 7 days.\n2. GST applicable as per schedule.",
        createdBy: "admin@hatikvah-care",
        createdAt: new Date(qDate + "T10:00:00Z").toISOString(),
        updatedAt: new Date(qDate + "T10:00:00Z").toISOString(),
      });
    }
  }

  if ((await store.invoices.count()) < 10) {
    const invTemplates = [
      { cust: allCusts[1] || cave, status: "paid", daysAgo: 5, payMode: "bank", items: [additionalItems[0], additionalItems[1]] },
      { cust: allCusts[2] || cave, status: "partial", daysAgo: 7, payMode: "upi", items: [additionalItems[2], additionalItems[3]] },
      { cust: allCusts[3] || cave, status: "issued", daysAgo: 2, payMode: null, items: [additionalItems[0], additionalItems[2]] },
      { cust: allCusts[4] || cave, status: "paid", daysAgo: 10, payMode: "bank", items: [additionalItems[1], additionalItems[3]] },
      { cust: allCusts[5] || cave, status: "overdue", daysAgo: 35, payMode: null, items: [additionalItems[2]] },
      { cust: allCusts[6] || cave, status: "paid", daysAgo: 4, payMode: "bank", items: [additionalItems[0], additionalItems[3]] },
      { cust: allCusts[7] || cave, status: "partial", daysAgo: 8, payMode: "upi", items: [additionalItems[1], additionalItems[2]] },
      { cust: allCusts[8] || cave, status: "issued", daysAgo: 1, payMode: null, items: [additionalItems[0]] },
      { cust: allCusts[9] || cave, status: "paid", daysAgo: 12, payMode: "bank", items: [additionalItems[2], additionalItems[3]] },
    ];

    for (let i = 0; i < invTemplates.length && (await store.invoices.count()) < 10; i++) {
      const it = invTemplates[i];
      const invNum = await nextNumber(store, "INV");
      const invDate = addDays(todayIST(), -it.daysAgo);
      const dueDate = addDays(invDate, 30);
      const lines = it.items.map((l) => ({
        productId: l.sku,
        sku: l.sku,
        name: l.name,
        hsn: l.hsn,
        qty: Math.floor(Math.random() * 4) + 2,
        unit: l.unit,
        rate: l.rate,
        discountPct: 0,
        gstRate: l.gstRate,
      }));
      const doc = await priced(store, { items: lines, customer: it.cust, placeOfSupply: it.cust.stateCode || "36" });
      const inv = await store.invoices.insert({
        number: invNum,
        token: token(),
        customerId: it.cust.id,
        customer: customerSnapshot(it.cust),
        date: invDate,
        dueDate,
        ...doc,
        amountInWords: amountInWords(doc.totals.total),
        status: it.status === "paid" ? "paid" : it.status === "partial" ? "partial" : "unpaid",
        amountPaid: 0,
        notes: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
        createdBy: "admin@hatikvah-care",
        createdAt: new Date(invDate + "T11:00:00Z").toISOString(),
        updatedAt: new Date(invDate + "T11:00:00Z").toISOString(),
      });

      for (const line of lines) {
        await moveStock(store, {
          productId: line.productId,
          sku: line.sku,
          qty: -line.qty,
          kind: "out",
          ref: invNum,
          note: `Tax Invoice ${invNum} to ${it.cust.name}`,
          by: "admin@hatikvah-care",
        });
      }

      if (it.status === "paid") {
        await recordPayment(store, inv, {
          amount: doc.totals.total,
          date: invDate,
          mode: it.payMode || "bank",
          reference: `REF-${Math.floor(Math.random() * 899999 + 100000)}`,
          notes: "Full payment settled",
          by: "admin@hatikvah-care",
        });
      } else if (it.status === "partial") {
        await recordPayment(store, inv, {
          amount: Math.round(doc.totals.total / 2),
          date: invDate,
          mode: "upi",
          reference: `UPI-${Math.floor(Math.random() * 899999 + 100000)}`,
          notes: "50% advance payment received",
          by: "admin@hatikvah-care",
        });
      }
    }
  }

  // 7. 10 Purchases / POs with auto-incremented stock (+qty)
  const allSups = await store.suppliers.all();
  if ((await store.purchases.count()) < 10) {
    const poTemplates = [
      { sup: allSups[0] || suppliersData[0], bill: "BIO-INV-1092", daysAgo: 10, status: "received", items: [{ sku: "BIO-SHW-380", name: "BIO Red Grapefruit Shower Gel", qty: 200, rate: 14000, hsn: "3304" }] },
      { sup: allSups[1] || suppliersData[1], bill: "MED-INV-4412", daysAgo: 8, status: "received", items: [{ sku: "GLV-M-01", name: "Nitrile Gloves Powder Free", qty: 300, rate: 28000, hsn: "40151100" }] },
      { sup: allSups[2] || suppliersData[2], bill: "CP-INV-8891", daysAgo: 6, status: "received", items: [{ sku: "DIAP-L-01", name: "Adult Diaper Comfort Premium", qty: 500, rate: 36000, hsn: "96190010" }] },
      { sup: allSups[3] || suppliersData[3], bill: "GR-INV-3321", daysAgo: 5, status: "received", items: [{ sku: "WC-FOLD-01", name: "Foldable Lightweight Wheelchair", qty: 30, rate: 420000, hsn: "87131000" }] },
      { sup: allSups[4] || suppliersData[4], bill: "PD-INV-9901", daysAgo: 4, status: "received", items: [{ sku: "BP-DIG-01", name: "Digital Blood Pressure Monitor", qty: 60, rate: 115000, hsn: "90189011" }] },
      { sup: allSups[5] || suppliersData[5], bill: "APX-INV-7712", daysAgo: 3, status: "ordered", items: [{ sku: "OXI-01", name: "Fingertip Pulse Oximeter", qty: 100, rate: 58000, hsn: "90181990" }] },
      { sup: allSups[6] || suppliersData[6], bill: "SH-INV-5541", daysAgo: 2, status: "ordered", items: [{ sku: "PAD-6090", name: "Disposable Underpads 60x90cm", qty: 400, rate: 24000, hsn: "96190020" }] },
      { sup: allSups[7] || suppliersData[7], bill: "PHF-INV-2210", daysAgo: 2, status: "ordered", items: [{ sku: "COMM-01", name: "Commode Chair Foldable", qty: 50, rate: 145000, hsn: "90219090" }] },
      { sup: allSups[8] || suppliersData[8], bill: "", daysAgo: 1, status: "draft", items: [{ sku: "NEB-01", name: "Compressor Nebulizer Machine", qty: 40, rate: 105000, hsn: "90192090" }] },
      { sup: allSups[9] || suppliersData[9], bill: "", daysAgo: 1, status: "draft", items: [{ sku: "BIO-BRK-001", name: "BIO Kopou Phul - Brackets", qty: 150, rate: 13000, hsn: "39269099" }] },
    ];

    for (let i = 0; i < poTemplates.length && (await store.purchases.count()) < 10; i++) {
      const pt = poTemplates[i];
      const poNum = await nextNumber(store, "PO");
      const poDate = addDays(todayIST(), -pt.daysAgo);
      const lines = pt.items.map((it) => ({
        productId: it.sku,
        sku: it.sku,
        name: it.name,
        hsn: it.hsn,
        qty: it.qty,
        unit: "NOS",
        cost: it.rate,
        total: it.qty * it.rate,
      }));
      const totalCost = lines.reduce((s, l) => s + l.total, 0);

      await store.purchases.insert({
        number: poNum,
        supplierId: pt.sup.id,
        supplierName: pt.sup.name,
        billNumber: pt.bill || "",
        date: poDate,
        expectedDate: addDays(poDate, 7),
        items: lines,
        total: totalCost,
        status: pt.status,
        receivedAt: pt.status === "received" ? new Date(poDate + "T14:00:00Z").toISOString() : null,
        notes: `PO placed with ${pt.sup.name}`,
        createdBy: "admin@hatikvah-care",
        createdAt: new Date(poDate + "T09:00:00Z").toISOString(),
        updatedAt: new Date(poDate + "T09:00:00Z").toISOString(),
      });

      if (pt.status === "received") {
        for (const line of lines) {
          await moveStock(store, {
            productId: line.productId,
            sku: line.sku,
            qty: line.qty,
            kind: "in",
            ref: poNum + (pt.bill ? ` (Bill ${pt.bill})` : ""),
            note: `Received from ${pt.sup.name}`,
            by: "admin@hatikvah-care",
          });
        }
      }
    }
  }

  log.info?.("[seedDemo] Rich mock data seeding complete!");
}

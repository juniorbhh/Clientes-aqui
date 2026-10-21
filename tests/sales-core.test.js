const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../dist/sales-core');
test('Brazilian money and fractional kilo sales preserve cent totals',()=>{
 assert.equal(C.cents('1.234,56'),123456);
 assert.equal(C.cents('3,00'),300);
 assert.equal(C.cents('2.50'),250);
 assert.equal(C.lineTotal(0.29,150),44);
 assert.ok(Number.isNaN(C.lineTotal(0.0001,150)));
 assert.ok(Number.isNaN(C.cents('-1')));
 const v=C.totals([{product:'Palha',unit:'kg',quantity:1.5,unit_price_cents:2500},{product:'Pimentinha',unit:'fardo',quantity:2,unit_price_cents:3300}],350,5000);
 assert.deepEqual(v,{subtotal:10350,total:10000,paid:5000,balance:5000});
 assert.throws(()=>C.totals([{product:'Palha',unit:'kg',quantity:1,unit_price_cents:1000}],0,1001));
});
test('dashboard counts receipts by payment date and outstanding across periods',()=>{
 const sales=[{client_id:'a',delivered_on:'2026-09-01',total_cents:10000,paid_cents:6000,payments:[{amount_cents:2000,paid_on:'2026-09-01'},{amount_cents:4000,paid_on:'2026-10-02'}]},{client_id:'a',delivered_on:'2026-10-20',total_cents:5000,paid_cents:5000,payments:[{amount_cents:5000,paid_on:'2026-10-20'}]}];
 assert.deepEqual(C.dashboard(sales,'2026-10'),{sold:5000,received:9000,balance:4000,deliveries:1});
 const stats=C.clientStats('a',sales,[{client_id:'a',visited_on:'2026-10-21'}],'2026-10-22');
 assert.equal(stats.days,2);assert.equal(stats.lastVisit,'2026-10-21');assert.equal(stats.balance,4000);
 assert.equal(C.clientStats('new',sales,[],'2026-10-22').last,null);
});

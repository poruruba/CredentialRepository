'use strict';

//const vConsole = new VConsole();
//window.datgui = new dat.GUI();

const base_url = "";
const APIKEY_KEY = "";
const QRCODE_CANCEL_TIMER = 20000;

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    data: {
        apikey: "",

        fido_issuer: "",
        fido_list: [],

        otp_list: [],
        otp_code: "",
        otp_item: {},
        otp_url: null,

        pwd_list: [],
        pwd_insert: {},
        pwd_update: {},
        pwd_get: {},
        chk_special_pattern: '-+*/_',
        chk_number: true,
        chk_upper: true,
        chk_special: true,
        chk_exception: true,
    },
    computed: {
    },
    methods: {
        input_apikey: function(){
            var apikey = prompt("ApiKeyを入力してください。");
            if( !apikey )
                return;
            this.apikey = apikey;
            localStorage.setItem(APIKEY_KEY, apikey);
            alert("リロードしてください。");
        },
        toDatetimeString: function(tim){
            if( !tim )
                return "";
            return new Date(tim).toLocaleString();
        },
        
        fido_update_list: async function(){
            try{
                var result = await do_post_with_apikey(base_url + "/fido2-device-list", {}, this.apikey );
                console.log(result);
                this.fido_list = result.list;
                this.fido_issuer = result.issuer;
            }catch(error){
                alert('失敗しました。');
            }
        },
        fido_delete: async function(index){
            try{
                if( !confirm('本当に削除しますか。') )
                    return;
                var result = await do_post_with_apikey(base_url + "/fido2-device-delete", { id: this.fido_list[index].id }, this.apikey );
                this.fido_update_list();
            }catch(error){
                alert('失敗しました。');
            }
        },
        fido_edit: async function(index){
            try{
                var name = prompt("新しい名前を入力してください", this.fido_list[index].name);
                if( name == null )
                    return;
                var result = await do_post_with_apikey(base_url + "/fido2-device-update", { id: this.fido_list[index].id, name: name }, this.apikey );
                console.log(result);
                alert('変更しました。');
                this.fido_update_list();
            }catch(error){
                alert('失敗しました。');
            }
        },

        otp_update_list: async function(){
            try{
                var result = await do_post_with_apikey(base_url + "/otp-list", {}, this.apikey );
                console.log(result);
                this.otp_list = result.list;
            }catch(error){
                alert('失敗しました。');
            }
        },
        otp_delete: async function(index){
            try{
                if( !confirm('本当に削除しますか。') )
                    return;
                var result = await do_post_with_apikey(base_url + "/otp-delete", { uuid: this.otp_list[index].uuid }, this.apikey );
                console.log(result);
                this.otp_update_list();
            }catch(error){
                alert('失敗しました。');
            }
        },
        otp_generate: async function(index){
            try{
                var result = await do_post_with_apikey(base_url + "/otp-generate", { uuid: this.otp_list[index].uuid }, this.apikey );
                console.log(result);
                this.otp_code = result.code;
                this.dialog_open('#dialog_code_display');
            }catch(error){
                alert('失敗しました。');
            }
        },
        otp_generate_copy: function(code){
            this.clip_copy(code);
            this.toast_show("クリップボードにコピーしました。");
        },
        otp_generate_generate_copy: async function(index){
            try{
                var result = await do_post_with_apikey(base_url + "/otp-generate", { uuid: this.otp_list[index].uuid }, this.apikey );
                console.log(result);
                this.clip_copy(result.code);
                this.toast_show("クリップボードにコピーしました。");
            }catch(error){
                alert('失敗しました。');
            }
        },
        otp_register: async function(){
            try{
                var result = await do_post_with_apikey(base_url + "/otp-register", { url: this.otp_url }, this.apikey );
                console.log(result);
                alert("登録しました。");
                this.dialog_close('#dialog_qrcode_scan');
            }catch(error){
                alert('失敗しました。');
            }
        },
        otp_export: async function(index){
            try{
                var param = {
                    uuid: this.otp_list[index].uuid
                };
                var result = await do_post_with_apikey(base_url + '/otp-get', param, this.apikey);
                var element = document.querySelector('#password_qrcode_area');
                element.innerHTML = '';
                new QRCode(element, result.uri);
                this.dialog_open("#dialog_password_qrcode", true);
            } catch (error) {
                console.error(error);
                alert(error);
            }
        },

        otp_file_drop: function(e){
            console.log(e);
            if( e.dataTransfer.files.length == 0 )
                return;
    
            var file = e.dataTransfer.files[0];
            const type = file.type;
            if(type.startsWith('image/')){
                var reader = new FileReader();
                reader.onload = (e) => {
                    var data_url = e.target.result;
                    qrcode_from_dataurl(data_url)
                    .then(code =>{
                        this.otp_set_url(code.data);
                    });

                };
                reader.readAsDataURL(file);
            }else
            if( type.startsWith('text/')){
                var reader = new FileReader();
                reader.onload = (e) => {
                    this.otp_set_url(e.target.result.trim());
                };
                reader.readAsText(file);
            }else{
                console.log(file);
                alert('サポートしていません。');
            }
        },
        otp_text_paste: function(e){
            console.log(e);
            if (e.clipboardData.types.length == 0)
                return;
    
            var item = e.clipboardData.items[0];
            const type = item.type;
            if( type.startsWith('text/')){
                item.getAsString(str =>{
                    if( type == "text/html" ){
                        var src = parse_htmlclipboard(str, type);
                        if( src == null ){
                            this.otp_set_url(str);
                        }else{
                            do_get_blob(src)
                            .then(blob =>{
                                var reader = new FileReader();
                                reader.onload = (e) => {
                                    var data_url = e.target.result;
                                    qrcode_from_dataurl(data_url)
                                    .then(code =>{
                                        this.otp_set_url(code.data);
                                    });
                                };
                                reader.readAsDataURL(blob) ;
                            });
                        }
                    }else{
                        this.otp_set_url(str.trim());
                    }
                });
            }else
            if( type.startsWith('image/')){
                var imageFile = item.getAsFile();
                var reader = new FileReader();
                reader.onload = (e) => {
                    var data_url = e.target.result;
                    qrcode_from_dataurl(data_url)
                    .then(code =>{
                        this.otp_set_url(code.data);
                    });
                };
                reader.readAsDataURL(imageFile);
            }else{
                console.log(item);
                alert('サポートしていません。');
            }
        },
        otp_qrcode_register_dialog_close: function(){
            if( this.qrcode_forcestop )
                this.qrcode_forcestop("");
            this.dialog_close('#dialog_qrcode_scan');
        },
        otp_set_url: function(url){
            this.otp_item = {};
            this.otp_url = "";
            if( !url )
                return;
            
            var data = otp_parse_url(url);
            if( !data ){
                alert("invalid url");
                return;
            }
            this.otp_item = data;
            this.otp_url = url;
        },
        otp_qrcode_paste_start: function(){
            this.qrcode_paste_start();
            this.dialog_open("#dialog_qrcode_scan");
        },
        otp_qrcode_scan_start: function(){
            this.qrcode_scan_start();
            this.dialog_open("#dialog_qrcode_scan");
        },

        qrcode_paste_start: function(){
            if( this.qrcode_forcestop )
                this.qrcode_forcestop("");
            this.otp_url = "";
        },        
        qrcode_scan_start: async function(){
            this.otp_url = null;
            if( !this.qrcode_video )
                this.qrcode_video = document.createElement("video");
            const qrcode_canvas = document.querySelector('#qrcode_canvas');
            let qrcode_context;
            let qrcode_running = true;

            this.qrcode_forcestop = (code) =>{
                if (qrcode_timer != null) {
                    clearTimeout(qrcode_timer);
                    qrcode_timer = null;
                }

                this.otp_set_url(code);
                
                this.qrcode_video.pause();
                this.qrcode_video.srcObject = null;
                qrcode_running = false;
            };
            let qrcode_timer = setTimeout(() => {
                this.qrcode_forcestop("");
            }, QRCODE_CANCEL_TIMER);

            const qrcode_draw = () =>{
                if (qrcode_context == null) {
                    if (this.qrcode_video.videoWidth == 0 || this.qrcode_video.videoHeight == 0) {
                        if (qrcode_running)
                            requestAnimationFrame(qrcode_draw);
                        return;
                    }
                    qrcode_canvas.height = Math.floor(qrcode_canvas.width * (this.qrcode_video.videoHeight / this.qrcode_video.videoWidth));
                    qrcode_context = qrcode_canvas.getContext('2d');
                }
                qrcode_context.drawImage(this.qrcode_video, 0, 0, qrcode_canvas.width, qrcode_canvas.height);
                const imageData = qrcode_context.getImageData(0, 0, qrcode_canvas.width, qrcode_canvas.height);

                const code = jsQR(imageData.data, qrcode_canvas.width, qrcode_canvas.height);
                if (code && code.data != "") {
                    console.log(code);
                    this.qrcode_forcestop(code.data);
                } else {
                    if (qrcode_running)
                        requestAnimationFrame(qrcode_draw);
                }
            };

            return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
            .then(stream => {
                this.qrcode_video.srcObject = stream;
                this.qrcode_video.setAttribute("playsinline", true);
                this.qrcode_video.play();
                qrcode_draw();
            })
            .catch(error => {
              alert(error);
            });
        },

        password_qrcode_dialog_show: async function (index) {
            try{
                var param = {
                    uuid: this.pwd_list[index].uuid,
                };
                var result = await do_post_with_apikey(base_url + '/pwd-get', param, this.apikey);
                var element = document.querySelector('#password_qrcode_area');
                element.innerHTML = '';
                new QRCode(element, result.item.password);
                this.dialog_open("#dialog_password_qrcode", true);
            } catch (error) {
                console.error(error);
                alert(error);
            }
        },
        password_clipboard_copy: async function(text){
            this.clip_copy(text);
            this.toast_show("クリップボードにコピーしました。");
        },
        password_clipboard_get_copy: async function(index){
            try{
                var param = {
                    uuid: this.pwd_list[index].uuid,
                };
                var json = await do_post_with_apikey(base_url + '/pwd-get', param, this.apikey);
                this.clip_copy(json.item.password);
                this.toast_show("クリップボードにコピーしました。");
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        password_create: function(){
            var passwd_num = 12;
            var passwd_number_num = this.chk_number ? 1 : 0;
            var passwd_symbol_num = this.chk_special ? 1 : 0;

            var kind = Array(passwd_num);
            kind.fill(0);
            for( var i = 0 ; i < passwd_number_num ; i++ )
                kind[i] = 'n';
            for( var i = 0 ; i < passwd_symbol_num ; i++ )
                kind[passwd_number_num + i] = 's';

            for( var i = 0 ; i < passwd_num ; i++ ){
                var index = make_random(passwd_num - 1);
                if( index == i || kind[i] == kind[index] )
                    continue;
                var temp = kind[i];
                kind[i] = kind[index];
                kind[index] = temp;
            }

            const number_pattern = '0123456789';
            var alpha_pattern = '';
            if( this.passwd_check_ecept_lO )
                alpha_pattern += "abcdefghijkmnopqrstuvwxyz";
            else
                alpha_pattern += "abcdefghijklmnopqrstuvwxyz";
            if( this.chk_upper ){
                if( this.chk_exception )
                    alpha_pattern += "ABCDEFGHJKLMNPQRSTUVWXYZ";
                else
                    alpha_pattern += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            }

            var passwd = '';
            for( var i = 0 ; i < kind.length ; i++ ){
                if( kind[i] == 'n' ){
                    var index = make_random(number_pattern.length - 1);
                    passwd += number_pattern.charAt(index);
                }else if( kind[i] == 's' ){
                    var pattern = this.chk_special_pattern;
                    var index = make_random(pattern.length - 1);
                    passwd += pattern.charAt(index);
                }else{
                    var index = make_random(alpha_pattern.length - 1);
                    passwd += alpha_pattern.charAt(index);
                }
            }

            this.pwd_insert.password = passwd;
        },
        password_insert_call: async function(){
            try{
	            var param = {
	                name: this.pwd_insert.name,
	                url: this.pwd_insert.url,
	                userid: this.pwd_insert.userid,
	                password: this.pwd_insert.password,
	                description: this.pwd_insert.description
	            };
                var result = await do_post_with_apikey(base_url + '/pwd-insert', param, this.apikey);
                alert('追加しました。');
                this.dialog_close('#dialog_password_insert');
                this.password_list_update();
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        password_list_update: async function(){
            try{
                var result = await do_post_with_apikey(base_url + '/pwd-list', {}, this.apikey);
                console.log(result);
                this.pwd_list = result.list;
            }catch(error){
                console.log(error);
                alert('リスト取得に失敗しました: ' + error);
            }
        },
        password_delete_call: async function(index){
            if( !confirm('本当に削除しますか？') )
                return;

            try{
	            var param = {
	                uuid: this.pwd_list[index].uuid
	            };
                var json = await do_post_with_apikey(base_url + '/pwd-delete', param, this.apikey);
                alert('削除しました。');
                this.password_list_update();
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        password_update_call: async function(){
            if( !confirm('本当に変更しますか？') )
                return;

            try{
	            var param = {
	                uuid: this.pwd_update.uuid,
	                name: this.pwd_update.name,
	                url: this.pwd_update.url,
	                userid: this.pwd_update.userid,
	                password: this.pwd_update.password,
	                description: this.pwd_update.description
	            };
                var json = await do_post_with_apikey(base_url + '/pwd-update', param, this.apikey);
                alert('変更しました。');
                this.password_list_update();
                this.dialog_close('#dialog_password_update');
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        password_insert_dialog_show: function(){
            this.pwd_insert = {
                name: "",
                url: "",
                userid: "",
                password: ""
            };
            this.dialog_open("#dialog_password_insert", "true");
        },
        password_update_dialog_show: async function(index){
            try{
                var param = {
                    uuid: this.pwd_list[index].uuid,
                };
                var json = await do_post_with_apikey(base_url + '/pwd-get', param, this.apikey);
                this.pwd_update = json.item;
                this.dialog_open("#dialog_password_update", "true");
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        password_display_dialog_show: async function(index){
            try{
                var param = {
                    uuid: this.pwd_list[index].uuid,
                };
                var json = await do_post_with_apikey(base_url + '/pwd-get', param, this.apikey);
                this.pwd_get = json.item;
                this.dialog_open("#dialog_password_get", "true");
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
    },
    created: function(){
    },
    mounted: function(){
        proc_load();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').then(async (registration) => {
                registration.update();
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }).catch((err) => {
                console.log('ServiceWorker registration failed: ', err);
            });
        }
	    
        this.apikey = localStorage.getItem(APIKEY_KEY);
        this.password_list_update();
        this.fido_update_list();
        this.otp_update_list();
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );

function do_post_with_apikey(url, body, apikey) {
    const headers = new Headers({ "Content-Type": "application/json", "X-API-KEY": apikey });
  
    return fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: headers
    })
    .then((response) => {
      if (!response.ok)
        throw new Error('status is not 200');
      return response.json();
  //    return response.text();
  //    return response.blob();
  //    return response.arrayBuffer();
    });
}

function do_get_blob(url, qs) {
    const params = new URLSearchParams(qs);

    var params_str = params.toString();
    var postfix = (params_str == "") ? "" : ((url.indexOf('?') >= 0) ? ('&' + params_str) : ('?' + params_str));
    return fetch(url + postfix, {
        method: 'GET',
    })
    .then((response) => {
        if (!response.ok)
        throw 'status is not 200';
    //    return response.json();
    //    return response.text();
        return response.blob();
    //    return response.arrayBuffer();
    });
}

function parse_htmlclipboard(html, type="text/html"){
    let parser = new DOMParser()
    var doc = parser.parseFromString(html, type);
    var body = doc.querySelector("html > body")
    if(body.firstChild.nextSibling.data == "StartFragment"){
        var target = body.firstElementChild;
        if(target.localName == "img")
            return target.src;
    }
    return null;
}

function otp_parse_url(qrcode){
    try{
        let url = new URL(qrcode);
        if( url.protocol != "otpauth:" )
            return null;
        url = new URL("https:" + qrcode.slice("otpauth:".length));
        if(url.hostname != "totp" && url.hostname != "hotp")
            return null;
        var data = {
            account_name: decodeURI(url.pathname).slice(1),
            secret: url.searchParams.get("secret"),
            issuer: url.searchParams.get("issuer"),
            method: url.hostname
        };
        return data;
    }catch(error){
        return null;
    }
}

function make_random(max){
	return Math.floor(Math.random() * (max + 1));
}

function qrcode_from_dataurl(data_url){
    return new Promise((resolve, reject) =>{
        const image = new Image();
        image.onload = () =>{
            const qrcode_canvas = document.createElement("canvas");
            qrcode_canvas.width = image.width;
            qrcode_canvas.height = image.width;
            const qrcode_context = qrcode_canvas.getContext('2d');
            qrcode_context.drawImage(image, 0, 0, image.width, image.width);
            const imageData = qrcode_context.getImageData(0, 0, qrcode_canvas.width, qrcode_canvas.height);

            const code = jsQR(imageData.data, qrcode_canvas.width, qrcode_canvas.height);
            if (code && code.data) {
                console.log(code);
                resolve(code);
            }else{
                resolve(null);
            }
        };
        image.onerror = (error) =>{
            reject(error);
        };
        image.src = data_url;
    });
}

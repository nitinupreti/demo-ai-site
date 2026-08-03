/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

@ExtendWith(AemContextExtension.class)
class ContactModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/contact-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-contact"); }});
        ContactModel m = r.adaptTo(ContactModel.class);
        assertNotNull(m);
        assertEquals("Say Hi!", m.getSayHiLabel());
        assertEquals("Send Message", m.getSubmitLabel());
    }

    @Test
    void configuredFully() {
        Map<String, Object> p = new HashMap<>();
        p.put("sling:resourceType", "demo-ai-site/components/pos-contact");
        p.put("sayHiLabel", "Say Hi");
        p.put("getQuoteLabel", "Quote");
        p.put("submitLabel", "Send!");
        p.put("submitAction", "/bin/contact");
        Resource r = context.create().resource("/content/test/contact-full", p);
        ContactModel m = r.adaptTo(ContactModel.class);
        assertNotNull(m);
        assertEquals("Send!", m.getSubmitLabel());
        assertEquals("/bin/contact", m.getSubmitAction());
    }
}

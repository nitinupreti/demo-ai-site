package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class SiteFooterModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(SiteFooterModel.class, FooterLinkModel.class);
    }

    @Test
    void defaultsWhenEmpty() {
        SiteFooterModel model = context.create().resource("/content/footer").adaptTo(SiteFooterModel.class);

        assertEquals("TOTC", model.getBrandName());
        assertEquals("Subscribe", model.getSubmitLabel());
        assertTrue(model.getLinks().isEmpty());
        assertTrue(model.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource resource = context.create().resource("/content/footer", "brandName", "Academy", "tagline", "Virtual learning", "newsletterTitle", "Updates", "emailPlaceholder", "Email", "submitLabel", "Join", "copyright", "Copyright");
        Resource links = context.create().resource(resource, "links");
        context.create().resource(links, "privacy", "label", "Privacy", "link", "/privacy");

        SiteFooterModel model = resource.adaptTo(SiteFooterModel.class);

        assertEquals("Academy", model.getBrandName());
        assertEquals("Privacy", model.getLinks().get(0).getLabel());
        assertEquals("/privacy", model.getLinks().get(0).getLink());
    }
}
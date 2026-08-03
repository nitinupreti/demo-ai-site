/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model for the Positivus Logo Strip (partner / client wall).
 */
@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class LogoStripModel {

    private static final String TREATMENT_NONE = "none";
    private static final String TREATMENT_MONO = "mono";
    private static final String TREATMENT_MUTED = "muted";

    @ChildResource
    private List<LogoItem> logos;

    @ValueMapValue @Default(values = TREATMENT_NONE)
    private String treatment;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (logos == null) {
            logos = new ArrayList<>();
        } else {
            logos.removeIf(item -> item == null || !item.isHasContent());
        }
        if (!TREATMENT_MONO.equals(treatment) && !TREATMENT_MUTED.equals(treatment)) {
            treatment = TREATMENT_NONE;
        }
        hasContent = !logos.isEmpty();
    }

    public List<LogoItem> getLogos() {
        return Collections.unmodifiableList(logos);
    }

    public String getTreatment() {
        return treatment;
    }

    public boolean isHasContent() {
        return hasContent;
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class LogoItem {

        @org.apache.sling.models.annotations.injectorspecific.ValueMapValue
        private String image;

        @org.apache.sling.models.annotations.injectorspecific.ValueMapValue
        private String alt;

        public String getImage() { return image; }
        public String getAlt() { return alt == null ? "" : alt; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(image);
        }
    }
}
